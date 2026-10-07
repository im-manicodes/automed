import { Injectable } from '@nestjs/common';
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
 * Extrae el texto de las páginas digitales de un PDF (markdown, sin OCR) con pdfjs-dist en este
 * mismo proceso (`PdfTextNode`). Nunca lanza: con PDF_TEXT_MODE=off devuelve null y el llamador
 * usa el flujo de OCR.
 */
@Injectable()
export class PdfExtractClientService {
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
    if (!this.node) return null;
    return this.node.extract(pdf);
  }
}
