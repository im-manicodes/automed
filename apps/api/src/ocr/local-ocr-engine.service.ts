import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OcrEngine, OcrPageResult, OcrWord } from './ocr-engine.interface';
import { OcrConfig, readOcrConfig } from './ocr-config';

interface LocalItem {
  text: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface LocalResponse {
  words?: LocalItem[];
  lines?: LocalItem[];
}

const toWord = (i: LocalItem): OcrWord => ({
  text: i.text,
  confidence: i.confidence,
  box: { x: i.x, y: i.y, w: i.w, h: i.h },
});

/** Adaptador del servicio Python `services/ocr-local` (PaddleOCR/Tesseract en CPU) por HTTP. */
@Injectable()
export class LocalOcrEngineService implements OcrEngine {
  readonly name = 'local';
  private readonly cfg: OcrConfig;

  constructor(config: ConfigService) {
    this.cfg = readOcrConfig(config);
  }

  async recognize(
    image: Uint8Array,
    pageNumber: number,
  ): Promise<OcrPageResult> {
    const res = await fetch(`${this.cfg.localUrl}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from(image),
      signal: AbortSignal.timeout(this.cfg.localTimeoutMs),
    });
    if (!res.ok) {
      throw new Error(`ocr-local respondió ${res.status}`);
    }
    const data = (await res.json()) as LocalResponse;
    return {
      pageNumber,
      words: (data.words ?? []).map(toWord),
      lines: (data.lines ?? []).map(toWord),
    };
  }
}
