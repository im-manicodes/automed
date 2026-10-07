import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OcrConfig, readOcrConfig } from './ocr-config';
import { PdfTextNode } from './pdf-text-node';

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
 * Con PDF_TEXT_MODE=node no usa HTTP: extrae con pdfjs-dist en este mismo proceso (`PdfTextNode`).
 */
@Injectable()
export class PdfExtractClientService {
  private readonly logger = new Logger(PdfExtractClientService.name);
  private readonly cfg: OcrConfig;
  private readonly node?: PdfTextNode;

  constructor(config: ConfigService) {
    this.cfg = readOcrConfig(config);
    if (this.cfg.pdfTextMode === 'node') {
      this.node = new PdfTextNode(this.cfg.pdfTextMinChars);
    }
  }

  get enabled(): boolean {
    return this.cfg.pdfTextMode !== 'off';
  }

  async extract(pdf: Uint8Array): Promise<PdfTextPage[] | null> {
    if (!this.enabled) return null;
    if (this.node) return this.node.extract(pdf);
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
