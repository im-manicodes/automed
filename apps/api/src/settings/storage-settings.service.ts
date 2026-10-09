import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenCryptoService } from '../auth/token-crypto.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  S3StorageService,
  type S3StorageConfig,
} from '../storage/s3-storage.service';

export const STORAGE_CONFIG_KEY = 'storage.config';

export type StorageProvider = 'rustfs' | 's3';

/** Lo que se guarda en `Setting` `storage.config` (secretos cifrados). */
export interface StorageStoredConfig {
  proveedor?: StorageProvider;
  rustfs?: {
    endpoint?: string;
    bucket?: string;
    accessKey?: string;
    secretKeyEnc?: string;
  };
  s3?: {
    region?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKeyEnc?: string;
    endpoint?: string;
  };
}

/** Respuesta pública: jamás incluye los secretos, solo si existen. */
export interface StoragePublicSettings {
  configurado: boolean;
  origen: 'panel' | 'env' | 'ninguno';
  proveedor: StorageProvider | null;
  rustfs: {
    endpoint: string;
    bucket: string;
    accessKey: string;
    tieneSecreto: boolean;
  };
  s3: {
    region: string;
    bucket: string;
    accessKeyId: string;
    endpoint: string;
    tieneSecreto: boolean;
  };
}

/** Entrada de PUT/test. Secreto omitido o vacío = conservar el guardado. */
export interface StorageSettingsInput {
  proveedor?: string;
  rustfs?: {
    endpoint?: string;
    bucket?: string;
    accessKey?: string;
    secretKey?: string;
  };
  s3?: {
    region?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    endpoint?: string;
  };
}

/** Configuración vigente con secretos descifrados. NUNCA exponerla por la API. */
interface Resolved {
  origen: 'panel' | 'env' | 'ninguno';
  proveedor: StorageProvider | null;
  rustfs: {
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  };
  s3: {
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint: string;
  };
  forcePathStyleEnv: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v.trim() : undefined;

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Nombre de bucket S3 válido: 3-63 car., minúsculas/dígitos/puntos/guiones, empieza y termina alfanumérico. */
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

@Injectable()
export class StorageSettingsService {
  private cache: { stored: StorageStoredConfig | null; r: Resolved } | null =
    null;
  private listeners: Array<() => void> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: TokenCryptoService,
  ) {}

  /** Avisa al guardar (el almacenamiento dinámico recrea su cliente). */
  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  private decrypt(enc?: string): string | undefined {
    if (!enc) return undefined;
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return undefined; // TOKEN_ENC_KEY cambió o dato dañado: sin secreto
    }
  }

  private env(k: string): string {
    return (this.config.get<string>(k) ?? '').trim();
  }

  private resolve(stored: StorageStoredConfig | null): Resolved {
    const envEndpoint = this.env('S3_ENDPOINT');
    const proveedor: StorageProvider | null =
      stored?.proveedor ?? (envEndpoint ? 'rustfs' : null);
    const origen = stored?.proveedor
      ? 'panel'
      : envEndpoint
        ? 'env'
        : 'ninguno';
    const r = stored?.rustfs;
    const s = stored?.s3;
    return {
      origen,
      proveedor,
      rustfs: {
        endpoint: r?.endpoint || envEndpoint,
        bucket: r?.bucket || this.env('S3_BUCKET') || 'automed',
        accessKey: r?.accessKey || this.env('S3_ACCESS_KEY'),
        secretKey:
          this.decrypt(r?.secretKeyEnc) ?? (this.env('S3_SECRET_KEY') || ''),
      },
      s3: {
        region: s?.region || this.env('S3_REGION') || 'us-east-1',
        bucket: s?.bucket || '',
        accessKeyId: s?.accessKeyId || '',
        secretAccessKey: this.decrypt(s?.secretAccessKeyEnc) ?? '',
        endpoint: s?.endpoint || '',
      },
      forcePathStyleEnv: this.env('S3_FORCE_PATH_STYLE') !== 'false',
    };
  }

  private async load() {
    if (this.cache) return this.cache;
    const row = await this.prisma.setting.findUnique({
      where: { key: STORAGE_CONFIG_KEY },
    });
    const stored = isObj(row?.value)
      ? (row.value as StorageStoredConfig)
      : null;
    this.cache = { stored, r: this.resolve(stored) };
    return this.cache;
  }

  private toS3Config(r: Resolved): S3StorageConfig | null {
    if (r.proveedor === 'rustfs') {
      if (!r.rustfs.endpoint || !r.rustfs.bucket) return null;
      return {
        endpoint: r.rustfs.endpoint,
        region: this.env('S3_REGION') || 'us-east-1',
        bucket: r.rustfs.bucket,
        accessKeyId: r.rustfs.accessKey,
        secretAccessKey: r.rustfs.secretKey,
        forcePathStyle: r.origen === 'env' ? r.forcePathStyleEnv : true,
      };
    }
    if (r.proveedor === 's3') {
      if (!r.s3.bucket || !r.s3.region) return null;
      return {
        ...(r.s3.endpoint ? { endpoint: r.s3.endpoint } : {}),
        region: r.s3.region,
        bucket: r.s3.bucket,
        accessKeyId: r.s3.accessKeyId || undefined,
        secretAccessKey: r.s3.secretAccessKey || undefined,
        forcePathStyle: !!r.s3.endpoint,
      };
    }
    return null;
  }

  /** Config S3 vigente (panel > .env) o null si no hay almacenamiento configurado. */
  async getEffectiveS3Config(): Promise<S3StorageConfig | null> {
    return this.toS3Config((await this.load()).r);
  }

  /** Vista segura para la web: nunca contiene secretos. */
  async getPublic(): Promise<StoragePublicSettings> {
    const { r } = await this.load();
    return {
      configurado: this.toS3Config(r) !== null,
      origen: r.origen,
      proveedor: r.proveedor,
      rustfs: {
        endpoint: r.rustfs.endpoint,
        bucket: r.rustfs.bucket,
        accessKey: r.rustfs.accessKey,
        tieneSecreto: !!r.rustfs.secretKey,
      },
      s3: {
        region: r.s3.region,
        bucket: r.s3.bucket,
        accessKeyId: r.s3.accessKeyId,
        endpoint: r.s3.endpoint,
        tieneSecreto: !!r.s3.secretAccessKey,
      },
    };
  }

  /** Valida la entrada y la mezcla con lo guardado (secreto vacío = conservar). 400 en español. */
  private build(
    input: StorageSettingsInput,
    stored: StorageStoredConfig | null,
  ): StorageStoredConfig {
    if (!isObj(input)) throw new BadRequestException('Datos no válidos');
    const proveedor = str(input.proveedor);
    if (proveedor !== 'rustfs' && proveedor !== 's3') {
      throw new BadRequestException('El proveedor debe ser rustfs o s3');
    }
    const next: StorageStoredConfig = {
      ...(stored ?? {}),
      proveedor,
    };
    const checkBucket = (b: string | undefined) => {
      if (!b || !BUCKET_RE.test(b) || /\.\./.test(b)) {
        throw new BadRequestException(
          'El nombre del bucket debe tener de 3 a 63 caracteres: minúsculas, números, puntos o guiones',
        );
      }
      return b;
    };
    const checkUrl = (u: string | undefined, req: boolean) => {
      if (!u) {
        if (req) throw new BadRequestException('Falta la dirección (endpoint)');
        return undefined;
      }
      if (u.length > 500 || !isHttpUrl(u)) {
        throw new BadRequestException(
          'La dirección debe empezar con http:// o https://',
        );
      }
      return u.replace(/\/+$/, '');
    };
    const secret = (v: unknown): string | undefined => {
      const t = str(v);
      if (!t) return undefined;
      if (t.length > 500)
        throw new BadRequestException('El secreto es muy largo');
      return t;
    };

    if (proveedor === 'rustfs') {
      const i = isObj(input.rustfs) ? input.rustfs : {};
      const prev = stored?.rustfs ?? {};
      const accessKey = str(i.accessKey) ?? prev.accessKey;
      if (!accessKey || accessKey.length > 200) {
        throw new BadRequestException('Falta la clave de acceso');
      }
      const sec = secret(i.secretKey);
      const secretKeyEnc = sec ? this.crypto.encrypt(sec) : prev.secretKeyEnc;
      if (!secretKeyEnc && !this.env('S3_SECRET_KEY')) {
        throw new BadRequestException('Falta la clave secreta');
      }
      next.rustfs = {
        endpoint: checkUrl(str(i.endpoint) ?? prev.endpoint, true),
        bucket: checkBucket(str(i.bucket) ?? prev.bucket),
        accessKey,
        ...(secretKeyEnc ? { secretKeyEnc } : {}),
      };
    } else {
      const i = isObj(input.s3) ? input.s3 : {};
      const prev = stored?.s3 ?? {};
      const region = str(i.region) ?? prev.region;
      if (!region || region.length > 60) {
        throw new BadRequestException('Falta la región');
      }
      const accessKeyId = str(i.accessKeyId) ?? prev.accessKeyId;
      const sec = secret(i.secretAccessKey);
      const secretAccessKeyEnc = sec
        ? this.crypto.encrypt(sec)
        : prev.secretAccessKeyEnc;
      if (!!accessKeyId !== !!secretAccessKeyEnc) {
        throw new BadRequestException(
          'Indica la clave de acceso y la clave secreta juntas (o ninguna para usar el rol de AWS)',
        );
      }
      const endpoint =
        i.endpoint !== undefined
          ? checkUrl(str(i.endpoint), false)
          : prev.endpoint;
      next.s3 = {
        region,
        bucket: checkBucket(str(i.bucket) ?? prev.bucket),
        ...(accessKeyId ? { accessKeyId } : {}),
        ...(secretAccessKeyEnc ? { secretAccessKeyEnc } : {}),
        ...(endpoint ? { endpoint } : {}),
      };
    }
    return next;
  }

  /** Guarda (valida; 400 en español), crea el bucket (sin fallar si no se puede) y devuelve la vista pública. */
  async save(input: StorageSettingsInput): Promise<StoragePublicSettings> {
    const { stored } = await this.load();
    const next = this.build(input, stored);
    const value = JSON.parse(JSON.stringify(next)) as Prisma.InputJsonObject;
    await this.prisma.setting.upsert({
      where: { key: STORAGE_CONFIG_KEY },
      update: { value },
      create: { key: STORAGE_CONFIG_KEY, value },
    });
    this.cache = null;
    this.listeners.forEach((fn) => fn());
    return this.getPublic();
  }

  /** Prueba la config del cuerpo (o la efectiva si no hay cuerpo). No guarda nada. */
  async test(
    input?: StorageSettingsInput,
  ): Promise<{ ok: boolean; mensaje: string }> {
    const { stored, r } = await this.load();
    let cfg: S3StorageConfig | null;
    if (input && isObj(input) && Object.keys(input).length > 0) {
      const resolved = this.resolve(this.build(input, stored));
      cfg = this.toS3Config(resolved);
    } else {
      cfg = this.toS3Config(r);
    }
    if (!cfg) {
      return { ok: false, mensaje: 'Almacenamiento sin configurar' };
    }
    const svc = new S3StorageService(cfg);
    try {
      await svc.probe();
      return {
        ok: true,
        mensaje:
          'Conexión correcta: se pudo guardar y borrar un archivo de prueba.',
      };
    } catch (e) {
      return { ok: false, mensaje: explainStorageError(e) };
    } finally {
      svc.destroy();
    }
  }
}

/** Traduce errores del SDK/red a español sencillo, sin credenciales ni detalles internos. */
export function explainStorageError(e: unknown): string {
  const err = e as {
    name?: string;
    code?: string;
    cause?: { code?: string };
    $metadata?: { httpStatusCode?: number };
  };
  const code = err.code ?? err.cause?.code ?? '';
  const name = err.name ?? '';
  const status = err.$metadata?.httpStatusCode;
  if (
    [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ECONNRESET',
    ].includes(code) ||
    name === 'TimeoutError'
  ) {
    return 'No se pudo conectar con la dirección indicada. Revisa que sea correcta y que el servidor esté encendido.';
  }
  if (
    [
      'InvalidAccessKeyId',
      'SignatureDoesNotMatch',
      'InvalidSignatureException',
    ].includes(name) ||
    name === 'CredentialsProviderError' ||
    status === 401
  ) {
    return 'Las credenciales no son válidas. Revisa la clave de acceso y la clave secreta.';
  }
  if (
    name === 'BucketAlreadyExists' ||
    name === 'BucketAlreadyOwnedByYou' ||
    status === 409
  ) {
    return 'Ese nombre de bucket ya está en uso por otra cuenta. Elige otro nombre.';
  }
  if (name === 'AccessDenied' || status === 403) {
    return 'Sin permiso para usar ese bucket: puede pertenecer a otra cuenta o tus credenciales no tienen acceso.';
  }
  return 'No se pudo usar el almacenamiento. Revisa los datos e inténtalo de nuevo.';
}
