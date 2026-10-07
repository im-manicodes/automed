import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenCryptoService } from '../auth/token-crypto.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_MODELS, readLlmConfig } from '../llm/llm-config';
import type { LlmConfig, LlmProviderName } from '../llm/llm-config';
import { LLM_TASKS } from '../llm/llm-provider.interface';
import type { LlmTask } from '../llm/llm-provider.interface';

export const AI_CONFIG_KEY = 'ia.config';
export const AI_WELCOME_KEY = 'ia.bienvenida';

export const AI_PROVIDERS: readonly LlmProviderName[] = [
  'ollama',
  'openai',
  'anthropic',
  'bedrock',
];

export const MIN_MAX_INPUT_TOKENS = 2000;
const DEFAULT_MAX_INPUT_TOKENS = 60000;

/** Lo que se guarda en `Setting` `ia.config` (solo lo que el panel fijó; claves cifradas). */
export interface AiStoredConfig {
  proveedor?: LlmProviderName;
  modelos?: Partial<Record<LlmTask, string>>;
  ollamaUrl?: string;
  awsRegion?: string;
  maxInputTokens?: number;
  openaiKeyEnc?: string;
  anthropicKeyEnc?: string;
  awsAccessKeyIdEnc?: string;
  awsSecretEnc?: string;
}

/** Configuración vigente (panel sobre .env). Contiene claves: NUNCA exponerla por la API. */
export interface AiEffectiveConfig {
  proveedor: LlmProviderName;
  modelos: Record<LlmTask, string>;
  ollamaUrl: string;
  awsRegion: string;
  maxInputTokens: number;
  origen: 'panel' | 'servidor';
  /** Config lista para los adaptadores (incluye claves en claro). */
  llm: LlmConfig;
}

export interface AiSuggestedModels {
  texto: string[];
  vision: string[];
}

/** Respuesta pública: jamás incluye claves, solo si existen. */
export interface AiPublicSettings {
  necesitaBienvenida: boolean;
  proveedor: LlmProviderName;
  origen: 'panel' | 'servidor';
  modelos: Record<LlmTask, string>;
  ollamaUrl: string;
  awsRegion: string;
  maxInputTokens: number;
  claves: { openai: boolean; anthropic: boolean; aws: boolean };
  sugeridos: Record<LlmProviderName, AiSuggestedModels>;
}

/** Entrada de `save` (parcial). `claveX: null` borra la clave guardada. */
export interface AiSettingsInput {
  proveedor?: LlmProviderName;
  modelos?: Partial<Record<LlmTask, string>>;
  ollamaUrl?: string;
  awsRegion?: string;
  maxInputTokens?: number;
  claveOpenai?: string | null;
  claveAnthropic?: string | null;
  /** Las dos claves de AWS van juntas: ambas con valor, o ambas null para borrarlas. */
  claveAwsAccessKeyId?: string | null;
  claveAwsSecreto?: string | null;
  bienvenidaCompletada?: boolean;
}

const SUGGESTED: Record<LlmProviderName, AiSuggestedModels> = {
  openai: {
    texto: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    vision: ['gpt-5', 'gpt-4.1', 'gpt-4o'],
  },
  anthropic: {
    texto: ['claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-sonnet-4-5'],
    vision: ['claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-sonnet-4-5'],
  },
  bedrock: {
    texto: [
      'anthropic.claude-sonnet-5-5',
      'anthropic.claude-haiku-4-5',
      'amazon.nova-pro-v1:0',
      'amazon.nova-lite-v1:0',
    ],
    vision: [
      'anthropic.claude-sonnet-5-5',
      'amazon.nova-pro-v1:0',
      'amazon.nova-lite-v1:0',
    ],
  },
  ollama: {
    texto: [
      'qwen3-vl:4b-instruct',
      'qwen2.5vl:3b',
      'qwen2.5vl:7b',
      'llama3.2:3b',
    ],
    vision: [
      'qwen3-vl:4b-instruct',
      'qwen2.5vl:3b',
      'qwen2.5vl:7b',
      'llama3.2-vision:11b',
    ],
  },
};

/** Credenciales AWS en claro (solo para construir clientes; nunca se exponen ni se registran). */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

interface Snapshot {
  stored: AiStoredConfig | null;
  welcomeDone: boolean;
  effective: AiEffectiveConfig;
}

@Injectable()
export class AiSettingsService {
  private cache: Snapshot | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: TokenCryptoService,
  ) {}

  private decryptKey(enc?: string): string | undefined {
    if (!enc) return undefined;
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return undefined; // TOKEN_ENC_KEY cambió o dato dañado: se trata como sin clave
    }
  }

  private async load(): Promise<Snapshot> {
    if (this.cache) return this.cache;
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [AI_CONFIG_KEY, AI_WELCOME_KEY] } },
    });
    const cfgRow = rows.find((r) => r.key === AI_CONFIG_KEY);
    const welcomeRow = rows.find((r) => r.key === AI_WELCOME_KEY);
    const stored = isObj(cfgRow?.value)
      ? (cfgRow.value as AiStoredConfig)
      : null;
    const welcomeDone =
      isObj(welcomeRow?.value) && welcomeRow.value.completada === true;
    const snap: Snapshot = {
      stored,
      welcomeDone,
      effective: this.merge(stored),
    };
    this.cache = snap;
    return snap;
  }

  private merge(stored: AiStoredConfig | null): AiEffectiveConfig {
    const env = readLlmConfig(this.config);
    const proveedor =
      stored?.proveedor && AI_PROVIDERS.includes(stored.proveedor)
        ? stored.proveedor
        : env.provider;
    // Los modelos del .env solo valen si el proveedor es el del .env.
    const sameAsEnv = proveedor === env.provider;
    const baseText = sameAsEnv ? env.modelText : DEFAULT_MODELS[proveedor];
    const baseVision = sameAsEnv ? env.modelVision : undefined;
    const m = stored?.modelos ?? {};
    const resumen = m.resumen || baseText;
    const modelos: Record<LlmTask, string> = {
      resumen,
      whatsapp: m.whatsapp || (sameAsEnv ? baseText : resumen),
      evento: m.evento || (sameAsEnv ? baseText : resumen),
      reporte: m.reporte || (sameAsEnv ? baseText : resumen),
      vision: m.vision || baseVision || resumen,
    };
    const ollamaUrl = stored?.ollamaUrl || env.ollamaBaseUrl;
    const awsRegion = stored?.awsRegion || env.awsRegion;
    const envTokens = Number(this.config.get<string>('SYNTH_MAX_INPUT_TOKENS'));
    const maxInputTokens =
      stored?.maxInputTokens && stored.maxInputTokens >= MIN_MAX_INPUT_TOKENS
        ? stored.maxInputTokens
        : Number.isFinite(envTokens) && envTokens >= MIN_MAX_INPUT_TOKENS
          ? envTokens
          : DEFAULT_MAX_INPUT_TOKENS;
    const openaiApiKey =
      this.decryptKey(stored?.openaiKeyEnc) ?? env.openaiApiKey;
    const anthropicApiKey =
      this.decryptKey(stored?.anthropicKeyEnc) ?? env.anthropicApiKey;
    const awsCredentials = this.awsFrom(stored);
    return {
      proveedor,
      modelos,
      ollamaUrl,
      awsRegion,
      maxInputTokens,
      origen: stored ? 'panel' : 'servidor',
      llm: {
        ...env,
        provider: proveedor,
        modelText: modelos.resumen,
        modelVision: modelos.vision,
        openaiApiKey,
        anthropicApiKey,
        ollamaBaseUrl: ollamaUrl,
        awsRegion,
        ...(awsCredentials ? { awsCredentials } : {}),
      },
    };
  }

  private awsFrom(stored: AiStoredConfig | null): AwsCredentials | undefined {
    const accessKeyId = this.decryptKey(stored?.awsAccessKeyIdEnc);
    const secretAccessKey = this.decryptKey(stored?.awsSecretEnc);
    return accessKeyId && secretAccessKey
      ? { accessKeyId, secretAccessKey }
      : undefined;
  }

  /** Credenciales AWS guardadas en el panel (descifradas) o undefined para usar la cadena por defecto de AWS. */
  async getAwsCredentials(): Promise<AwsCredentials | undefined> {
    return (await this.load()).effective.llm.awsCredentials;
  }

  /** Configuración vigente (panel > .env), con caché hasta el próximo `save`. */
  async getEffective(): Promise<AiEffectiveConfig> {
    return (await this.load()).effective;
  }

  /** Modelo configurado para la tarea. */
  async modelFor(task: LlmTask): Promise<string> {
    return (await this.getEffective()).modelos[task];
  }

  async bienvenidaCompletada(): Promise<boolean> {
    return (await this.load()).welcomeDone;
  }

  /** Vista segura para la web: nunca contiene claves. */
  async getPublic(): Promise<AiPublicSettings> {
    const { effective: e, welcomeDone } = await this.load();
    const sugeridos = {} as Record<LlmProviderName, AiSuggestedModels>;
    for (const p of AI_PROVIDERS) {
      const def = DEFAULT_MODELS[p];
      sugeridos[p] = {
        texto: [...new Set([def, ...SUGGESTED[p].texto])],
        vision: [...new Set([def, ...SUGGESTED[p].vision])],
      };
    }
    return {
      necesitaBienvenida: !welcomeDone,
      proveedor: e.proveedor,
      origen: e.origen,
      modelos: { ...e.modelos },
      ollamaUrl: e.ollamaUrl,
      awsRegion: e.awsRegion,
      maxInputTokens: e.maxInputTokens,
      claves: {
        openai: !!e.llm.openaiApiKey,
        anthropic: !!e.llm.anthropicApiKey,
        aws: !!e.llm.awsCredentials,
      },
      sugeridos,
    };
  }

  /** Guarda un cambio parcial (valida; 400 en español) y devuelve la vista pública. */
  async save(input: AiSettingsInput): Promise<AiPublicSettings> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new BadRequestException('Datos no válidos');
    }
    const { stored } = await this.load();
    const next: AiStoredConfig = { ...(stored ?? {}) };
    let touchesConfig = false;

    if (input.proveedor !== undefined) {
      if (!AI_PROVIDERS.includes(input.proveedor)) {
        throw new BadRequestException(
          'Proveedor no válido (ollama, openai, anthropic o bedrock)',
        );
      }
      if (input.proveedor !== next.proveedor && input.modelos === undefined) {
        delete next.modelos; // los modelos del proveedor anterior no sirven
      }
      next.proveedor = input.proveedor;
      touchesConfig = true;
    }
    if (input.modelos !== undefined) {
      if (!isObj(input.modelos)) {
        throw new BadRequestException('Los modelos no son válidos');
      }
      const modelos: Partial<Record<LlmTask, string>> = {
        ...(input.proveedor === undefined ||
        input.proveedor === stored?.proveedor
          ? (next.modelos ?? {})
          : {}),
      };
      for (const [k, v] of Object.entries(input.modelos)) {
        if (!LLM_TASKS.includes(k as LlmTask)) {
          throw new BadRequestException(`Tarea desconocida: ${k}`);
        }
        const t = typeof v === 'string' ? v.trim() : '';
        if (t.length < 1 || t.length > 200) {
          throw new BadRequestException(
            'El modelo debe tener entre 1 y 200 caracteres',
          );
        }
        modelos[k as LlmTask] = t;
      }
      next.modelos = modelos;
      touchesConfig = true;
    }
    if (input.ollamaUrl !== undefined) {
      let ok = false;
      try {
        const u = new URL(String(input.ollamaUrl).trim());
        ok = u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        ok = false;
      }
      if (!ok) {
        throw new BadRequestException(
          'La dirección de Ollama debe empezar con http:// o https://',
        );
      }
      next.ollamaUrl = String(input.ollamaUrl).trim();
      touchesConfig = true;
    }
    if (input.awsRegion !== undefined) {
      const r =
        typeof input.awsRegion === 'string' ? input.awsRegion.trim() : '';
      if (!r || r.length > 50) {
        throw new BadRequestException('Indica la región de AWS');
      }
      next.awsRegion = r;
      touchesConfig = true;
    }
    if (input.maxInputTokens !== undefined) {
      const n = input.maxInputTokens;
      if (!Number.isInteger(n) || n < MIN_MAX_INPUT_TOKENS) {
        throw new BadRequestException(
          `El máximo de tokens de entrada debe ser un número entero de al menos ${MIN_MAX_INPUT_TOKENS}`,
        );
      }
      next.maxInputTokens = n;
      touchesConfig = true;
    }
    for (const [field, enc, label] of [
      ['claveOpenai', 'openaiKeyEnc', 'OpenAI'],
      ['claveAnthropic', 'anthropicKeyEnc', 'Anthropic'],
    ] as const) {
      const v = input[field];
      if (v === undefined) continue;
      if (v === null) {
        delete next[enc];
      } else {
        const t = typeof v === 'string' ? v.trim() : '';
        if (!t || t.length > 500) {
          throw new BadRequestException(
            `La clave de ${label} no es válida (para borrarla envía null)`,
          );
        }
        next[enc] = this.crypto.encrypt(t);
      }
      touchesConfig = true;
    }
    const awsId = input.claveAwsAccessKeyId;
    const awsSecret = input.claveAwsSecreto;
    if (awsId !== undefined || awsSecret !== undefined) {
      if (awsId === undefined || awsSecret === undefined) {
        throw new BadRequestException(
          'Las claves de AWS van juntas: indica la clave de acceso y el secreto',
        );
      }
      if (awsId === null && awsSecret === null) {
        delete next.awsAccessKeyIdEnc;
        delete next.awsSecretEnc;
      } else {
        const id = typeof awsId === 'string' ? awsId.trim() : '';
        const secret = typeof awsSecret === 'string' ? awsSecret.trim() : '';
        if (!id || id.length > 128 || /\s/.test(id)) {
          throw new BadRequestException(
            'La clave de acceso de AWS no es válida (para borrarla envía null junto con el secreto)',
          );
        }
        if (!secret || secret.length > 500) {
          throw new BadRequestException(
            'El secreto de AWS no es válido (para borrarlo envía null junto con la clave de acceso)',
          );
        }
        next.awsAccessKeyIdEnc = this.crypto.encrypt(id);
        next.awsSecretEnc = this.crypto.encrypt(secret);
      }
      touchesConfig = true;
    }
    if (
      input.bienvenidaCompletada !== undefined &&
      input.bienvenidaCompletada !== true
    ) {
      throw new BadRequestException('bienvenidaCompletada solo puede ser true');
    }

    if (touchesConfig) {
      const value = JSON.parse(JSON.stringify(next)) as Prisma.InputJsonObject;
      await this.prisma.setting.upsert({
        where: { key: AI_CONFIG_KEY },
        update: { value },
        create: { key: AI_CONFIG_KEY, value },
      });
    }
    if (input.bienvenidaCompletada === true) {
      const value = { completada: true };
      await this.prisma.setting.upsert({
        where: { key: AI_WELCOME_KEY },
        update: { value },
        create: { key: AI_WELCOME_KEY, value },
      });
    }
    this.cache = null;
    return this.getPublic();
  }
}
