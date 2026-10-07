import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLM_PROVIDER } from '../llm/llm-provider.interface';
import type { LlmProvider } from '../llm/llm-provider.interface';
import { cropRegionPng } from './image-crop';
import { OcrConfig, readOcrConfig } from './ocr-config';
import type { OcrBox } from './ocr-engine.interface';

export interface VisionReading {
  text: string;
  confidence: number;
}

const SYSTEM =
  'Eres un transcriptor de documentos. Recibes el recorte de una línea de un documento ' +
  'escaneado (puede ser manuscrito). Transcribe EXACTAMENTE lo que ves, de forma literal, sin ' +
  'interpretar, resumir ni corregir y sin añadir nada que no esté en la imagen. Escribe ' +
  '[ilegible] donde no puedas leer. Responde solo con JSON: {"text": "...", "confidence": 0.0-1.0}. ' +
  'Usa confidence baja si hay partes ilegibles.';

/** Extrae {text, confidence} de la respuesta del modelo (tolera texto/markdown alrededor). */
export function parseVisionReading(raw: string): VisionReading | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { text?: unknown; confidence?: unknown };
    if (typeof o.text !== 'string' || o.text.trim() === '') return null;
    const c = Number(o.confidence);
    if (!Number.isFinite(c)) return null;
    return { text: o.text.trim(), confidence: Math.min(1, Math.max(0, c)) };
  } catch {
    return null;
  }
}

/** Reintento opcional (OCR_VISION_RETRY=true): relee con un LLM con visión una región dudosa. */
@Injectable()
export class VisionRetryService {
  private readonly cfg: OcrConfig;

  constructor(
    config: ConfigService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {
    this.cfg = readOcrConfig(config);
  }

  get enabled() {
    return this.cfg.visionRetry;
  }

  get acceptThreshold() {
    return this.cfg.visionAcceptThreshold;
  }

  get maxRegions() {
    return this.cfg.visionMaxRegions;
  }

  /** Devuelve la lectura del modelo o null si no hubo respuesta usable. */
  async reread(
    pagePng: Uint8Array,
    box: OcrBox,
    ocrText: string,
  ): Promise<VisionReading | null> {
    const crop = await cropRegionPng(pagePng, box);
    const raw = await this.llm.vision(
      { mediaType: 'image/png', data: crop },
      `Lectura automática previa (puede estar mal): "${ocrText}". Transcribe el recorte.`,
      { system: SYSTEM, maxTokens: 300, temperature: 0, task: 'vision' },
    );
    return parseVisionReading(raw);
  }
}
