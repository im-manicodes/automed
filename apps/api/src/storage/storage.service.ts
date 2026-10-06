import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Los metadatos S3 deben ser ASCII: se codifican en URI (el nombre original sigue en BD). */
const encodeMetadata = (m: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(m).map(([k, v]) => [k, encodeURIComponent(v)]),
  );

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.get<string>('S3_BUCKET', 'automed');
    this.client = new S3Client({
      endpoint: config.get<string>('S3_ENDPOINT'),
      region: config.get<string>('S3_REGION', 'us-east-1'),
      forcePathStyle:
        config.get<string>('S3_FORCE_PATH_STYLE', 'true') === 'true',
      credentials: {
        accessKeyId: config.get<string>('S3_ACCESS_KEY', ''),
        secretAccessKey: config.get<string>('S3_SECRET_KEY', ''),
      },
    });
  }

  /** Crea el bucket si no existe; reintenta unos segundos (RustFS puede tardar en arrancar). No tumba la API. */
  async onModuleInit() {
    for (let i = 0; i < 6; i++) {
      if (await this.ensureBucket()) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
    this.logger.warn('No se pudo verificar/crear el bucket de RustFS');
  }

  private async ensureBucket(): Promise<boolean> {
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

  /** Comprobación ligera para /api/health. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  /** `metadata` (opcional): pares clave/valor ASCII (p. ej. filename, sha256) guardados como metadatos del objeto. */
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

  /** ¿Existe el objeto? (HeadObject; false ante cualquier error de no encontrado). */
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

  /** Borra un objeto concreto. */
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

  /** Borra solo los objetos cuya clave empieza por `prefix` (no vacío). Devuelve cuántos borró. */
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

  presignedGetUrl(key: string, expiresIn = 300) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }
}
