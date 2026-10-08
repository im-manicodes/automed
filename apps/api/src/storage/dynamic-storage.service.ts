import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { StorageSettingsService } from '../settings/storage-settings.service';
import { S3StorageService, type S3StorageConfig } from './s3-storage.service';
import { StorageService } from './storage.service';

export const STORAGE_UNCONFIGURED = 'Almacenamiento sin configurar';

/**
 * Almacenamiento S3 cuya configuración (RustFS o AWS S3) se resuelve por llamada desde los ajustes
 * (panel > .env), sin reiniciar. Cachea el cliente por hash de config; el bucket se crea de forma
 * perezosa en la primera operación con cada config. Sin config: isHealthy() false y las operaciones lanzan.
 */
@Injectable()
export class DynamicStorageService
  extends StorageService
  implements OnModuleInit
{
  private readonly logger = new Logger(DynamicStorageService.name);
  private current: {
    hash: string;
    svc: S3StorageService;
    ready: Promise<void>;
  } | null = null;

  constructor(private readonly settings: StorageSettingsService) {
    super();
    // Al guardar ajustes: soltar el cliente y crear el bucket de la nueva config.
    this.settings.onChange(() => {
      this.drop();
      void this.resolve().catch(() => undefined);
    });
  }

  /** No tumba la API: solo intenta dejar listo el bucket al arrancar. */
  onModuleInit() {
    void this.resolve().catch(() => undefined);
  }

  private drop() {
    this.current?.svc.destroy();
    this.current = null;
  }

  private static hash(cfg: S3StorageConfig): string {
    return createHash('sha256').update(JSON.stringify(cfg)).digest('hex');
  }

  private async resolve(): Promise<S3StorageService> {
    const cfg = await this.settings.getEffectiveS3Config();
    if (!cfg) {
      this.drop();
      throw new Error(STORAGE_UNCONFIGURED);
    }
    const hash = DynamicStorageService.hash(cfg);
    if (this.current?.hash !== hash) {
      this.drop();
      const svc = new S3StorageService(cfg);
      const ready = svc.ensureBucketWithRetry(3).then((ok) => {
        if (!ok) this.logger.warn('Bucket de almacenamiento no verificado');
      });
      this.current = { hash, svc, ready };
    }
    await this.current.ready;
    return this.current.svc;
  }

  async isHealthy(): Promise<boolean> {
    try {
      return await (await this.resolve()).isHealthy();
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
    return (await this.resolve()).put(key, body, contentType, metadata);
  }

  async copy(srcKey: string, dstKey: string) {
    return (await this.resolve()).copy(srcKey, dstKey);
  }

  async exists(key: string) {
    return (await this.resolve()).exists(key);
  }

  async delete(key: string) {
    return (await this.resolve()).delete(key);
  }

  async get(key: string) {
    return (await this.resolve()).get(key);
  }

  async deleteByPrefix(prefix: string) {
    return (await this.resolve()).deleteByPrefix(prefix);
  }
}
