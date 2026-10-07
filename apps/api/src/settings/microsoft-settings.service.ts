import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenCryptoService } from '../auth/token-crypto.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const MICROSOFT_CONFIG_KEY = 'microsoft.config';

const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_KEYWORDS = ['common', 'organizations', 'consumers'];

/** Lo que se guarda en `Setting` `microsoft.config` (secreto cifrado). */
export interface MicrosoftStoredConfig {
  clientId?: string;
  tenantId?: string;
  clientSecretEnc?: string;
  redirectUri?: string;
}

/** Configuración vigente (panel sobre .env). Contiene el secreto: NUNCA exponerla por la API. */
export interface MicrosoftEffectiveConfig {
  clientId: string;
  tenantId: string;
  clientSecret?: string;
  redirectUri: string;
}

/** Respuesta pública: jamás incluye el secreto, solo si existe. */
export interface MicrosoftPublicSettings {
  configurado: boolean;
  clientId: string;
  tenantId: string;
  tieneSecreto: boolean;
  redirectUri: string;
  redirectUriSugerida: string;
}

/** Entrada de `save` (parcial). `clientSecret: null` borra el secreto guardado. */
export interface MicrosoftSettingsInput {
  clientId?: string;
  tenantId?: string;
  clientSecret?: string | null;
  redirectUri?: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

@Injectable()
export class MicrosoftSettingsService {
  private cache: {
    stored: MicrosoftStoredConfig | null;
    effective: MicrosoftEffectiveConfig;
  } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: TokenCryptoService,
  ) {}

  private decrypt(enc?: string): string | undefined {
    if (!enc) return undefined;
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return undefined; // TOKEN_ENC_KEY cambió o dato dañado: se trata como sin secreto
    }
  }

  private suggested(): string {
    const web = (this.config.get<string>('WEB_ORIGIN') ?? '').replace(
      /\/+$/,
      '',
    );
    return `${web || 'http://localhost:5173'}/api/auth/callback`;
  }

  private merge(
    stored: MicrosoftStoredConfig | null,
  ): MicrosoftEffectiveConfig {
    const env = (k: string) => (this.config.get<string>(k) ?? '').trim();
    const clientSecret =
      this.decrypt(stored?.clientSecretEnc) ?? env('MS_CLIENT_SECRET');
    return {
      clientId: stored?.clientId || env('MS_CLIENT_ID'),
      tenantId: stored?.tenantId || env('MS_TENANT_ID') || 'common',
      ...(clientSecret ? { clientSecret } : {}),
      redirectUri:
        stored?.redirectUri || env('MS_REDIRECT_URI') || this.suggested(),
    };
  }

  private async load() {
    if (this.cache) return this.cache;
    const row = await this.prisma.setting.findUnique({
      where: { key: MICROSOFT_CONFIG_KEY },
    });
    const stored = isObj(row?.value)
      ? (row.value as MicrosoftStoredConfig)
      : null;
    this.cache = { stored, effective: this.merge(stored) };
    return this.cache;
  }

  /** Configuración vigente (panel > .env), con caché hasta el próximo `save`. */
  async getEffective(): Promise<MicrosoftEffectiveConfig> {
    return (await this.load()).effective;
  }

  async isConfigured(): Promise<boolean> {
    return !!(await this.getEffective()).clientId;
  }

  /** Vista segura para la web: nunca contiene el secreto. */
  async getPublic(): Promise<MicrosoftPublicSettings> {
    const e = await this.getEffective();
    return {
      configurado: !!e.clientId,
      clientId: e.clientId,
      tenantId: e.tenantId,
      tieneSecreto: !!e.clientSecret,
      redirectUri: e.redirectUri,
      redirectUriSugerida: this.suggested(),
    };
  }

  /** Guarda un cambio parcial (valida; 400 en español) y devuelve la vista pública. */
  async save(input: MicrosoftSettingsInput): Promise<MicrosoftPublicSettings> {
    if (!isObj(input)) throw new BadRequestException('Datos no válidos');
    const { stored } = await this.load();
    const next: MicrosoftStoredConfig = { ...(stored ?? {}) };

    if (input.clientId !== undefined) {
      const v = typeof input.clientId === 'string' ? input.clientId.trim() : '';
      if (!GUID_RE.test(v)) {
        throw new BadRequestException(
          'El ID de cliente debe ser un identificador como 11111111-2222-3333-4444-555555555555',
        );
      }
      next.clientId = v;
    }
    if (input.tenantId !== undefined) {
      const v = typeof input.tenantId === 'string' ? input.tenantId.trim() : '';
      if (!TENANT_KEYWORDS.includes(v.toLowerCase()) && !GUID_RE.test(v)) {
        throw new BadRequestException(
          'El inquilino debe ser common, organizations, consumers o un identificador',
        );
      }
      next.tenantId = TENANT_KEYWORDS.includes(v.toLowerCase())
        ? v.toLowerCase()
        : v;
    }
    if (input.clientSecret !== undefined) {
      if (input.clientSecret === null) {
        delete next.clientSecretEnc;
      } else {
        const v =
          typeof input.clientSecret === 'string'
            ? input.clientSecret.trim()
            : '';
        if (!v || v.length > 500) {
          throw new BadRequestException(
            'El secreto no es válido (para borrarlo envía null)',
          );
        }
        next.clientSecretEnc = this.crypto.encrypt(v);
      }
    }
    if (input.redirectUri !== undefined) {
      if (input.redirectUri === null || input.redirectUri === '') {
        delete next.redirectUri;
      } else {
        const v =
          typeof input.redirectUri === 'string' ? input.redirectUri.trim() : '';
        if (!v || v.length > 500 || !isHttpUrl(v)) {
          throw new BadRequestException(
            'La URL de redirección debe empezar con http:// o https://',
          );
        }
        next.redirectUri = v;
      }
    }

    const value = JSON.parse(JSON.stringify(next)) as Prisma.InputJsonObject;
    await this.prisma.setting.upsert({
      where: { key: MICROSOFT_CONFIG_KEY },
      update: { value },
      create: { key: MICROSOFT_CONFIG_KEY, value },
    });
    this.cache = null;
    return this.getPublic();
  }
}
