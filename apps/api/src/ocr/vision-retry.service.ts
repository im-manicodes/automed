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

function toReading(text: unknown, confidence: unknown): VisionReading | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  if (/\[ilegible\]/i.test(text)) return null;
  const c = Number(confidence);
  if (!Number.isFinite(c)) return null;
  return { text: text.trim(), confidence: Math.min(1, Math.max(0, c)) };
}

/** Máximo de sugerencias guardadas por zona dudosa. */
export const MAX_SUGERENCIAS = 2;

const normSug = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/**
 * Prompt fijo de la ÚNICA pasada de visión: por recorte, una lectura literal con su confianza y
 * hasta 2 alternativas para la revisión manual.
 */
export const VISION_ZONAS_SYSTEM =
  'Eres un transcriptor de documentos. Recibes varios recortes de líneas de un documento ' +
  'escaneado (puede ser manuscrito), numerados 1, 2, 3... en el mismo orden en que se ' +
  'adjuntan las imágenes, cada uno con la lectura automática previa del OCR, que es solo una ' +
  'pista y puede estar mal. Para cada recorte transcribe EXACTAMENTE lo que ves, de forma ' +
  'literal, sin interpretar, resumir ni corregir y sin añadir nada que no esté en la imagen; ' +
  'escribe [ilegible] donde no puedas leer. Indica tu confianza de 0.0 a 1.0 (baja si hay ' +
  'partes dudosas o ilegibles). Además propón hasta 2 lecturas alternativas distintas y ' +
  'plausibles, de más a menos probable, también literales (nunca [ilegible]); si no hay ' +
  'alternativas razonables deja la lista vacía. Si se te indica el ámbito o tipo de ' +
  'documentos, úsalo solo como contexto para leer bien lo que la imagen respalda claramente; ' +
  'si la imagen no lo respalda, no lo uses y escribe [ilegible]. Responde solo con un arreglo ' +
  'JSON, un elemento por recorte: ' +
  '[{"n": 1, "lectura": "...", "confianza": 0.0-1.0, "sugerencias": ["alternativa 1", "alternativa 2"]}, ...].';

/** Resultado por zona de la pasada única: lectura aceptable (o null) + sugerencias para revisión. */
export interface ZonaLeida {
  /** Lectura usable (sin `[ilegible]`, con confianza numérica) o null. */
  lectura: VisionReading | null;
  /**
   * Hasta 2 textos para la revisión: la lectura (si es válida) y las alternativas válidas, sin
   * vacías, `[ilegible]`, duplicadas ni iguales a la lectura previa del OCR.
   */
  sugerencias: string[];
}

/**
 * Salida de un lote de la pasada única (tolera texto/markdown alrededor y los nombres `text` /
 * `confidence`). Devuelve un arreglo alineado con `items`; JSON roto -> todo vacío.
 */
export function parseZonas(
  raw: string,
  items: { ocrText: string }[],
): ZonaLeida[] {
  const out: ZonaLeida[] = items.map(() => ({
    lectura: null,
    sugerencias: [],
  }));
  const m = /\[[\s\S]*\]/.exec(raw ?? '');
  if (!m) return out;
  let arr: unknown;
  try {
    arr = JSON.parse(m[0]);
  } catch {
    return out;
  }
  if (!Array.isArray(arr)) return out;
  for (const el of arr) {
    if (!el || typeof el !== 'object') continue;
    const o = el as {
      n?: unknown;
      lectura?: unknown;
      text?: unknown;
      confianza?: unknown;
      confidence?: unknown;
      sugerencias?: unknown;
    };
    const n = Number(o.n);
    if (!Number.isInteger(n) || n < 1 || n > items.length) continue;
    const texto = o.lectura !== undefined ? o.lectura : o.text;
    const lectura = toReading(
      texto,
      o.confianza !== undefined ? o.confianza : o.confidence,
    );
    const vistos = new Set<string>([normSug(items[n - 1].ocrText ?? '')]);
    const sug: string[] = [];
    const candidatos = [
      typeof texto === 'string' ? texto : undefined,
      ...(Array.isArray(o.sugerencias) ? (o.sugerencias as unknown[]) : []),
    ];
    for (const s of candidatos) {
      if (sug.length === MAX_SUGERENCIAS) break;
      if (typeof s !== 'string') continue;
      const t = s.trim();
      if (!t || /\[ilegible\]/i.test(t)) continue;
      const k = normSug(t);
      if (vistos.has(k)) continue;
      vistos.add(k);
      sug.push(t);
    }
    out[n - 1] = { lectura, sugerencias: sug };
  }
  return out;
}

/**
 * Relectura opcional con visión (Ajustes -> OCR u OCR_VISION_RETRY=true): UNA sola pasada en lote
 * por página con el modelo de la tarea `vision` (lectura + sugerencias).
 */
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

  get acceptThreshold() {
    return this.cfg.visionAcceptThreshold;
  }

  /** Modelo vigente de la tarea `vision` (solo el nombre, sin claves), para la vista de progreso. */
  modelFor(task: 'vision' = 'vision'): Promise<string> {
    return this.llm.modelFor(task);
  }

  async getMaxRegions(): Promise<number> {
    return (await this.ocrSettings.getEffective()).visionMaxRegions;
  }

  /**
   * Lee varias zonas de una misma página en UNA llamada (recortes numerados) con el modelo de
   * `vision`. Devuelve un arreglo alineado con `items` (lectura + sugerencias por zona).
   */
  async readZones(
    pagePng: Uint8Array,
    items: { box: OcrBox; ocrText: string }[],
    threadId?: string | null,
  ): Promise<ZonaLeida[]> {
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
        .join('\n') +
      '\nTranscribe cada recorte y propón hasta 2 lecturas alternativas.';
    const raw = await this.llm.complete({
      system: withScope(VISION_ZONAS_SYSTEM, ambito),
      prompt,
      images,
      maxTokens: Math.max(400, 200 * items.length),
      temperature: 0,
      task: 'vision',
      ...(threadId ? { threadId } : {}),
    });
    return parseZonas(raw, items);
  }
}
