import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

/** Los metadatos S3 deben ser ASCII: se codifican en URI (el nombre original sigue en BD). */
const encodeMetadata = (m: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(m).map(([k, v]) => [k, encodeURIComponent(v)]),
  );

/** Configuración explícita de un cliente S3 (RustFS, AWS S3...). Sin credenciales = cadena por defecto del SDK. */
export interface S3StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
}

/** Implementación S3 compatible (RustFS, AWS S3...). La config llega explícita (ver DynamicStorageService). */
export class S3StorageService extends StorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: S3StorageConfig) {
    super();
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      ...(cfg.accessKeyId && cfg.secretAccessKey
        ? {
            credentials: {
              accessKeyId: cfg.accessKeyId,
              secretAccessKey: cfg.secretAccessKey,
            },
          }
        : {}),
    });
  }

  /** Config desde las variables `S3_*` (CLI de migración). */
  static fromEnv(config: ConfigService): S3StorageService {
    return new S3StorageService({
      endpoint: config.get<string>('S3_ENDPOINT'),
      region: config.get<string>('S3_REGION', 'us-east-1'),
      bucket: config.get<string>('S3_BUCKET', 'automed'),
      accessKeyId: config.get<string>('S3_ACCESS_KEY', ''),
      secretAccessKey: config.get<string>('S3_SECRET_KEY', ''),
      forcePathStyle:
        config.get<string>('S3_FORCE_PATH_STYLE', 'true') === 'true',
    });
  }

  /** Comprueba/crea el bucket; reintenta unos segundos (RustFS puede tardar en arrancar). No lanza. */
  async ensureBucketWithRetry(attempts = 6): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      if (await this.ensureBucket()) return true;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000));
    }
    this.logger.warn('No se pudo verificar/crear el bucket de almacenamiento');
    return false;
  }

  async ensureBucket(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
        this.logger.log(`Bucket ${this.bucket} creado`);
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Prueba de extremo a extremo para "Probar conexión": crea el bucket si falta, escribe y borra un
   * objeto. Lanza el error crudo del SDK (quien llama lo traduce a un mensaje sencillo).
   */
  async probe(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      const name = (e as { name?: string }).name;
      if (status === 404 || name === 'NotFound' || name === 'NoSuchBucket') {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
      } else {
        throw e;
      }
    }
    const key = `.automed-test/${Date.now()}`;
    await this.put(key, Buffer.from('ok'), 'text/plain');
    await this.delete(key);
  }

  /** Libera las conexiones del cliente. */
  destroy() {
    this.client.destroy();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  async put(
    key: string,
    body: Buffer | Uint8Array,
    contentType?: string,
    metadata?: Record<string, string>,
  ) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(metadata ? { Metadata: encodeMetadata(metadata) } : {}),
      }),
    );
  }

  /** Copia server-side (CopyObject) dentro del mismo bucket. */
  async copy(srcKey: string, dstKey: string) {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: dstKey,
        CopySource: `${this.bucket}/${srcKey
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string) {
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: [{ Key: key }], Quiet: true },
      }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return res.Body!.transformToByteArray();
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    if (!prefix) throw new Error('El prefijo no puede estar vacío');
    let deleted = 0;
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      const keys = (res.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => !!k && k.startsWith(prefix));
      if (keys.length) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        deleted += keys.length;
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }
}
