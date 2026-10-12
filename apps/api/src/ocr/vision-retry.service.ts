import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OcrSettingsService } from '../settings/ocr-settings.service';
import { withScope } from '../templates/template-instructions';
import { LLM_PROVIDER } from '../llm/llm-provider.interface';
import type { LlmProvider } from '../llm/llm-provider.interface';
import { cropRegionPng } from './image-crop';
import { OcrConfig, readOcrConfig } from './ocr-config';
import type { OcrBox } from './ocr-engine.interface';

export interface VisionReading {
  text: string;
  confidence: number;
}

/** Máximo de recortes por llamada de visión (los modelos pequeños se confunden con muchos). */
export const VISION_BATCH_SIZE = 6;

export const VISION_BATCH_SYSTEM =
  'Eres un transcriptor de documentos. Recibes varios recortes de líneas de un documento ' +
  'escaneado (puede ser manuscrito), numerados 1, 2, 3... en el mismo orden en que se ' +
  'adjuntan las imágenes. Transcribe EXACTAMENTE lo que ves en cada uno, de forma literal, sin ' +
  'interpretar, resumir ni corregir y sin añadir nada que no esté en la imagen. Escribe ' +
  '[ilegible] donde no puedas leer. Responde solo con un arreglo JSON, un elemento por recorte: ' +
  '[{"n": 1, "text": "...", "confidence": 0.0-1.0}, ...]. ' +
  'Usa confidence baja si hay partes ilegibles. Si se te indica el ámbito o tipo de documentos, ' +
  'úsalo solo como contexto para leer bien lo que la imagen respalda claramente; si la imagen ' +
  'no lo respalda, no lo uses y escribe [ilegible].';

function toReading(text: unknown, confidence: unknown): VisionReading | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  if (/\[ilegible\]/i.test(text)) return null;
  const c = Number(confidence);
  if (!Number.isFinite(c)) return null;
  return { text: text.trim(), confidence: Math.min(1, Math.max(0, c)) };
}

/**
 * Extrae las lecturas de un lote (tolera texto/markdown alrededor). Devuelve un arreglo de
 * `count` posiciones; las ausentes o inválidas son null.
 */
export function parseVisionBatch(
  raw: string,
  count: number,
): (VisionReading | null)[] {
  const out: (VisionReading | null)[] = Array.from(
    { length: count },
    () => null,
  );
  const m = /\[[\s\S]*\]/.exec(raw);
  if (!m) return out;
  try {
    const arr = JSON.parse(m[0]) as unknown;
    if (!Array.isArray(arr)) return out;
    for (const el of arr) {
      if (!el || typeof el !== 'object') continue;
      const o = el as { n?: unknown; text?: unknown; confidence?: unknown };
      const n = Number(o.n);
      if (!Number.isInteger(n) || n < 1 || n > count) continue;
      out[n - 1] = toReading(o.text, o.confidence);
    }
  } catch {
    /* JSON roto: todo null */
  }
  return out;
}

/** Reintento opcional (Ajustes -> OCR u OCR_VISION_RETRY=true): relee con un LLM con visión las regiones dudosas, siempre en lote. */
@Injectable()
export class VisionRetryService {
  private readonly cfg: OcrConfig;

  constructor(
    config: ConfigService,
    private readonly ocrSettings: OcrSettingsService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {
    this.cfg = readOcrConfig(config);
  }

  /** Vigente por llamada (panel > .env). */
  async isEnabled(): Promise<boolean> {
    return (await this.ocrSettings.getEffective()).visionRetry;
  }

  /** Segundo intento con el modelo de respaldo (panel > .env; defecto activado). */
  async isSecondPassEnabled(): Promise<boolean> {
    return (await this.ocrSettings.getEffective()).visionSegundoIntento;
  }

  get acceptThreshold() {
    return this.cfg.visionAcceptThreshold;
  }

  /** Modelo vigente de la tarea (solo el nombre, sin claves), para la vista de progreso. */
  modelFor(task: 'vision' | 'vision_respaldo'): Promise<string> {
    return this.llm.modelFor(task);
  }

  async getMaxRegions(): Promise<number> {
    return (await this.ocrSettings.getEffective()).visionMaxRegions;
  }

  /**
   * Relee varias zonas de una misma página en UNA llamada (recortes numerados). Devuelve un
   * arreglo alineado con `items`; null = sin lectura usable. `task` elige el modelo: 'vision'
   * (primera pasada) o 'vision_respaldo' (segundo intento, también en lote).
   */
  async rereadBatch(
    pagePng: Uint8Array,
    items: { box: OcrBox; ocrText: string }[],
    task: 'vision' | 'vision_respaldo' = 'vision',
  ): Promise<(VisionReading | null)[]> {
    if (items.length === 0) return [];
    const images = [];
    for (const it of items) {
      images.push({
        mediaType: 'image/png',
        data: await cropRegionPng(pagePng, it.box),
      });
    }
    const ambito = (await this.ocrSettings.getEffective()).visionAmbito;
    const prompt =
      items
        .map(
          (it, i) =>
            `Recorte ${i + 1}: lectura automática previa (puede estar mal): "${it.ocrText}"`,
        )
        .join('\n') + '\nTranscribe cada recorte.';
    const raw = await this.llm.complete({
      system: withScope(VISION_BATCH_SYSTEM, ambito),
      prompt,
      images,
      maxTokens: Math.max(300, 150 * items.length),
      temperature: 0,
      task,
    });
    return parseVisionBatch(raw, items.length);
  }
}
