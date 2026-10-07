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
}

export interface OcrEffectiveConfig {
  motor: OcrMotor;
  textractMode: TextractMode;
  origen: 'panel' | 'servidor';
}

export interface OcrSettingsInput {
  motor?: OcrMotor;
  textractMode?: TextractMode;
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
    return {
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
    if (input.motor !== undefined || input.textractMode !== undefined) {
      const row = await this.prisma.setting.findUnique({
        where: { key: OCR_CONFIG_KEY },
      });
      const prev = isObj(row?.value) ? (row.value as OcrStoredConfig) : {};
      const next: OcrStoredConfig = { ...prev };
      if (input.motor !== undefined) next.motor = input.motor;
      if (input.textractMode !== undefined)
        next.textractMode = input.textractMode;
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
