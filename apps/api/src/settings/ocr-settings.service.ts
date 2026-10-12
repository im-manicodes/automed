import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../generated/prisma/client';
import { TokenCryptoService } from '../auth/token-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_VISION_AMBITO,
  MAX_VISION_AMBITO,
  validateScopeText,
} from '../templates/template-instructions';

export const OCR_CONFIG_KEY = 'ocr.config';

export type OcrMotor = 'local' | 'textract' | 'azure' | 'ninguno';
export type TextractMode = 'detect' | 'analyze';

export const OCR_MOTORS: readonly OcrMotor[] = [
  'local',
  'textract',
  'azure',
  'ninguno',
];
export const TEXTRACT_MODES: readonly TextractMode[] = ['detect', 'analyze'];

/** Lo que el panel fijó (Setting `ocr.config`). */
export interface OcrStoredConfig {
  motor?: OcrMotor;
  textractMode?: TextractMode;
  visionRetry?: boolean;
  /** Segundo intento en lote con el modelo de respaldo; ausente = activado. */
  visionSegundoIntento?: boolean;
  visionMaxRegions?: number;
  renderDpi?: number;
  /** Ámbito de la relectura con visión; ausente = por defecto, '' = sin ámbito. */
  visionAmbito?: string;
  azureEndpoint?: string;
  /** Clave de Azure AI Document Intelligence, cifrada AES-GCM (jamás se devuelve). */
  azureKeyEnc?: string;
}

/** Credenciales de Azure en claro (solo para construir llamadas; nunca se exponen ni se registran). */
export interface AzureOcrCredentials {
  endpoint: string;
  key: string;
}

export const MIN_VISION_MAX_REGIONS = 1;
export const MAX_VISION_MAX_REGIONS = 200;
export const MIN_RENDER_DPI = 150;
export const MAX_RENDER_DPI = 400;
const DEFAULT_VISION_MAX_REGIONS = 30;
const DEFAULT_RENDER_DPI = 250;

const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export interface OcrEffectiveConfig {
  motor: OcrMotor;
  textractMode: TextractMode;
  visionRetry: boolean;
  visionSegundoIntento: boolean;
  visionMaxRegions: number;
  renderDpi: number;
  visionAmbito: string;
  origen: 'panel' | 'servidor';
}

export interface OcrSettingsInput {
  motor?: OcrMotor;
  textractMode?: TextractMode;
  visionRetry?: boolean;
  visionSegundoIntento?: boolean;
  visionMaxRegions?: number;
  renderDpi?: number;
  /** string = texto; '' = sin ámbito; null = valor por defecto. */
  visionAmbito?: string | null;
  azureEndpoint?: string;
  /** string = clave nueva; null = quitarla. */
  claveAzure?: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Ajustes del OCR: panel > .env (OCR_ENGINE, TEXTRACT_MODE); por defecto `local`. */
@Injectable()
export class OcrSettingsService {
  private cache: OcrEffectiveConfig | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: TokenCryptoService,
  ) {}

  private merge(stored: OcrStoredConfig | null): OcrEffectiveConfig {
    const envMotor: OcrMotor =
      this.config.get<string>('OCR_ENGINE') === 'textract'
        ? 'textract'
        : 'local';
    const envMode: TextractMode =
      this.config.get<string>('TEXTRACT_MODE') === 'analyze'
        ? 'analyze'
        : 'detect';
    const envRegions = Number(
      this.config.get<string>('OCR_VISION_MAX_REGIONS'),
    );
    const envDpi = Number(this.config.get<string>('OCR_RENDER_DPI'));
    return {
      visionRetry:
        typeof stored?.visionRetry === 'boolean'
          ? stored.visionRetry
          : this.config.get<string>('OCR_VISION_RETRY') === 'true',
      visionSegundoIntento:
        typeof stored?.visionSegundoIntento === 'boolean'
          ? stored.visionSegundoIntento
          : true,
      visionMaxRegions: intIn(
        stored?.visionMaxRegions,
        MIN_VISION_MAX_REGIONS,
        MAX_VISION_MAX_REGIONS,
      )
        ? stored.visionMaxRegions
        : intIn(envRegions, MIN_VISION_MAX_REGIONS, MAX_VISION_MAX_REGIONS)
          ? envRegions
          : DEFAULT_VISION_MAX_REGIONS,
      renderDpi: intIn(stored?.renderDpi, MIN_RENDER_DPI, MAX_RENDER_DPI)
        ? stored.renderDpi
        : intIn(envDpi, MIN_RENDER_DPI, MAX_RENDER_DPI)
          ? envDpi
          : DEFAULT_RENDER_DPI,
      visionAmbito:
        typeof stored?.visionAmbito === 'string'
          ? stored.visionAmbito
          : DEFAULT_VISION_AMBITO,
      motor:
        stored?.motor && OCR_MOTORS.includes(stored.motor)
          ? stored.motor
          : envMotor,
      textractMode:
        stored?.textractMode && TEXTRACT_MODES.includes(stored.textractMode)
          ? stored.textractMode
          : envMode,
      origen: stored ? 'panel' : 'servidor',
    };
  }

  private async stored(): Promise<OcrStoredConfig | null> {
    const row = await this.prisma.setting.findUnique({
      where: { key: OCR_CONFIG_KEY },
    });
    return isObj(row?.value) ? row.value : null;
  }

  /** Endpoint y clave de Azure (panel > AZURE_OCR_ENDPOINT / AZURE_OCR_KEY); null si falta algo. */
  async getAzureCredentials(): Promise<AzureOcrCredentials | null> {
    const stored = await this.stored();
    const endpoint =
      stored?.azureEndpoint ||
      this.config.get<string>('AZURE_OCR_ENDPOINT') ||
      '';
    let key: string | undefined;
    if (stored?.azureKeyEnc) {
      try {
        key = this.crypto.decrypt(stored.azureKeyEnc);
      } catch {
        key = undefined; // TOKEN_ENC_KEY cambió o dato dañado
      }
    }
    key ??= this.config.get<string>('AZURE_OCR_KEY') || undefined;
    return endpoint && key ? { endpoint, key } : null;
  }

  /** Vista segura para la web: endpoint y si hay clave, nunca la clave. */
  async getAzurePublic(): Promise<{
    azureEndpoint: string;
    claveAzure: boolean;
  }> {
    const stored = await this.stored();
    const creds = await this.getAzureCredentials();
    return {
      azureEndpoint:
        stored?.azureEndpoint ||
        this.config.get<string>('AZURE_OCR_ENDPOINT') ||
        '',
      claveAzure: !!creds,
    };
  }

  /** Configuración vigente, con caché hasta el próximo `save`. */
  async getEffective(): Promise<OcrEffectiveConfig> {
    if (this.cache) return this.cache;
    const row = await this.prisma.setting.findUnique({
      where: { key: OCR_CONFIG_KEY },
    });
    const stored = isObj(row?.value) ? (row.value as OcrStoredConfig) : null;
    this.cache = this.merge(stored);
    return this.cache;
  }

  /** Guarda un cambio parcial (400 en español si es inválido). */
  async save(raw: OcrSettingsInput): Promise<OcrEffectiveConfig> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new BadRequestException('Datos no válidos');
    }
    const input: OcrSettingsInput = {
      motor: raw.motor,
      textractMode: raw.textractMode,
      visionRetry: raw.visionRetry,
      visionSegundoIntento: raw.visionSegundoIntento,
      visionMaxRegions: raw.visionMaxRegions,
      renderDpi: raw.renderDpi,
      visionAmbito: raw.visionAmbito,
      azureEndpoint: raw.azureEndpoint,
      claveAzure: raw.claveAzure,
    };
    if (input.azureEndpoint !== undefined) {
      let ok = false;
      try {
        const u = new URL(String(input.azureEndpoint).trim());
        ok = u.protocol === 'https:' || u.protocol === 'http:';
      } catch {
        ok = false;
      }
      if (!ok) {
        throw new BadRequestException(
          'La dirección de Azure debe empezar con https:// (por ejemplo https://mi-recurso.cognitiveservices.azure.com)',
        );
      }
    }
    if (input.claveAzure !== undefined && input.claveAzure !== null) {
      const t =
        typeof input.claveAzure === 'string' ? input.claveAzure.trim() : '';
      if (!t || t.length > 500) {
        throw new BadRequestException(
          'La clave de Azure no es válida (para borrarla envía null)',
        );
      }
    }
    if (input.motor !== undefined && !OCR_MOTORS.includes(input.motor)) {
      throw new BadRequestException(
        'Motor de OCR no válido (local, textract, azure o ninguno)',
      );
    }
    if (
      input.textractMode !== undefined &&
      !TEXTRACT_MODES.includes(input.textractMode)
    ) {
      throw new BadRequestException(
        'Modo de Textract no válido (detect o analyze)',
      );
    }
    if (
      input.visionRetry !== undefined &&
      typeof input.visionRetry !== 'boolean'
    ) {
      throw new BadRequestException(
        'Indica si se relee con IA las partes dudosas (sí o no)',
      );
    }
    if (
      input.visionSegundoIntento !== undefined &&
      typeof input.visionSegundoIntento !== 'boolean'
    ) {
      throw new BadRequestException(
        'Indica si se usa el segundo intento con otro modelo (sí o no)',
      );
    }
    if (
      input.visionMaxRegions !== undefined &&
      !intIn(
        input.visionMaxRegions,
        MIN_VISION_MAX_REGIONS,
        MAX_VISION_MAX_REGIONS,
      )
    ) {
      throw new BadRequestException(
        `El máximo de partes a releer debe ser un número entero entre ${MIN_VISION_MAX_REGIONS} y ${MAX_VISION_MAX_REGIONS}`,
      );
    }
    if (
      input.renderDpi !== undefined &&
      !intIn(input.renderDpi, MIN_RENDER_DPI, MAX_RENDER_DPI)
    ) {
      throw new BadRequestException(
        `La calidad de lectura debe ser un número entero entre ${MIN_RENDER_DPI} y ${MAX_RENDER_DPI} DPI`,
      );
    }
    if (input.visionAmbito !== undefined && input.visionAmbito !== null) {
      const err = validateScopeText(
        input.visionAmbito,
        MAX_VISION_AMBITO,
        'El tipo de documentos',
      );
      if (err) throw new BadRequestException(err);
    }
    if (
      input.motor !== undefined ||
      input.textractMode !== undefined ||
      input.visionRetry !== undefined ||
      input.visionSegundoIntento !== undefined ||
      input.visionMaxRegions !== undefined ||
      input.renderDpi !== undefined ||
      input.visionAmbito !== undefined ||
      input.azureEndpoint !== undefined ||
      input.claveAzure !== undefined
    ) {
      const prev = (await this.stored()) ?? {};
      const next: OcrStoredConfig = { ...prev };
      if (input.motor !== undefined) next.motor = input.motor;
      if (input.textractMode !== undefined)
        next.textractMode = input.textractMode;
      if (input.visionRetry !== undefined) next.visionRetry = input.visionRetry;
      if (input.visionSegundoIntento !== undefined)
        next.visionSegundoIntento = input.visionSegundoIntento;
      if (input.visionMaxRegions !== undefined)
        next.visionMaxRegions = input.visionMaxRegions;
      if (input.renderDpi !== undefined) next.renderDpi = input.renderDpi;
      if (input.visionAmbito === null) delete next.visionAmbito;
      else if (typeof input.visionAmbito === 'string')
        next.visionAmbito = input.visionAmbito.trim();
      if (input.azureEndpoint !== undefined)
        next.azureEndpoint = String(input.azureEndpoint)
          .trim()
          .replace(/\/+$/, '');
      if (input.claveAzure === null) delete next.azureKeyEnc;
      else if (typeof input.claveAzure === 'string')
        next.azureKeyEnc = this.crypto.encrypt(input.claveAzure.trim());
      const value = JSON.parse(JSON.stringify(next)) as Prisma.InputJsonObject;
      await this.prisma.setting.upsert({
        where: { key: OCR_CONFIG_KEY },
        update: { value },
        create: { key: OCR_CONFIG_KEY, value },
      });
    }
    this.cache = null;
    return this.getEffective();
  }
}
