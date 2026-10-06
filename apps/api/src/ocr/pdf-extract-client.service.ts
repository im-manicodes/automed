import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OcrConfig, readOcrConfig } from './ocr-config';

export interface PdfTextPage {
  pageNumber: number;
  kind: 'digital' | 'escaneada';
  markdown: string;
  width: number;
  height: number;
  chars: number;
}

/**
 * Cliente HTTP del servicio Python `services/pdf-extract` (PyMuPDF): clasifica cada página
 * (digital/escaneada) y devuelve markdown de las digitales, sin OCR. Nunca lanza: si está
 * desactivado (PDF_TEXT_MODE=off) o falla, devuelve null y el llamador usa el flujo de OCR.
 */
@Injectable()
export class PdfExtractClientService {
  private readonly logger = new Logger(PdfExtractClientService.name);
  private readonly cfg: OcrConfig;

  constructor(config: ConfigService) {
    this.cfg = readOcrConfig(config);
  }

  get enabled(): boolean {
    return this.cfg.pdfTextMode === 'auto';
  }

  async extract(pdf: Uint8Array): Promise<PdfTextPage[] | null> {
    if (!this.enabled) return null;
    try {
      const res = await fetch(
        `${this.cfg.pdfExtractUrl}/extract?min_chars=${this.cfg.pdfTextMinChars}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/pdf' },
          body: Buffer.from(pdf),
          signal: AbortSignal.timeout(this.cfg.pdfExtractTimeoutMs),
        },
      );
      if (!res.ok) {
        this.logger.warn(
          `pdf-extract respondió ${res.status}; se usa OCR para todas las páginas`,
        );
        return null;
      }
      const data = (await res.json()) as { pages?: PdfTextPage[] };
      return Array.isArray(data.pages) ? data.pages : null;
    } catch (e) {
      this.logger.warn(
        `pdf-extract no disponible (${(e as Error).name}); se usa OCR para todas las páginas`,
      );
      return null;
    }
  }
}
