import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const OCR_CONFIG_KEY = 'ocr.config';

export type OcrMotor = 'local' | 'textract' | 'ninguno';
export type TextractMode = 'detect' | 'analyze';

export const OCR_MOTORS: readonly OcrMotor[] = ['local', 'textract', 'ninguno'];
export const TEXTRACT_MODES: readonly TextractMode[] = ['detect', 'analyze'];

/** Lo que el panel fijó (Setting `ocr.config`). */
export interface OcrStoredConfig {
  motor?: OcrMotor;
  textractMode?: TextractMode;
  visionRetry?: boolean;
  visionMaxRegions?: number;
  renderDpi?: number;
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
  visionMaxRegions: number;
  renderDpi: number;
  origen: 'panel' | 'servidor';
}

export interface OcrSettingsInput {
  motor?: OcrMotor;
  textractMode?: TextractMode;
  visionRetry?: boolean;
  visionMaxRegions?: number;
  renderDpi?: number;
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
      visionMaxRegions: raw.visionMaxRegions,
      renderDpi: raw.renderDpi,
    };
    if (input.motor !== undefined && !OCR_MOTORS.includes(input.motor)) {
      throw new BadRequestException(
        'Motor de OCR no válido (local, textract o ninguno)',
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
    if (
      input.motor !== undefined ||
      input.textractMode !== undefined ||
      input.visionRetry !== undefined ||
      input.visionMaxRegions !== undefined ||
      input.renderDpi !== undefined
    ) {
      const row = await this.prisma.setting.findUnique({
        where: { key: OCR_CONFIG_KEY },
      });
      const prev = isObj(row?.value) ? (row.value as OcrStoredConfig) : {};
      const next: OcrStoredConfig = { ...prev };
      if (input.motor !== undefined) next.motor = input.motor;
      if (input.textractMode !== undefined)
        next.textractMode = input.textractMode;
      if (input.visionRetry !== undefined) next.visionRetry = input.visionRetry;
      if (input.visionMaxRegions !== undefined)
        next.visionMaxRegions = input.visionMaxRegions;
      if (input.renderDpi !== undefined) next.renderDpi = input.renderDpi;
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
