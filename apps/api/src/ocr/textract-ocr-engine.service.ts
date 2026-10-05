import {
  AnalyzeDocumentCommand,
  DetectDocumentTextCommand,
  TextractClient,
} from '@aws-sdk/client-textract';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OcrEngine, OcrPageResult } from './ocr-engine.interface';
import { OcrConfig, readOcrConfig } from './ocr-config';
import { mapTextractBlocks } from './textract-mapper';

/** Límite de Textract para documentos síncronos en bytes (PNG/JPEG). */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * AWS Textract (SDK v3). DetectDocumentText lee impreso y manuscrito; con
 * TEXTRACT_MODE=analyze usa AnalyzeDocument (FORMS+TABLES). Credenciales por la cadena
 * estándar de AWS (variables de entorno / rol IAM).
 */
@Injectable()
export class TextractOcrEngineService implements OcrEngine {
  readonly name = 'textract';
  private readonly cfg: OcrConfig;
  private client?: TextractClient;

  constructor(config: ConfigService) {
    this.cfg = readOcrConfig(config);
  }

  private getClient() {
    return (this.client ??= new TextractClient({ region: this.cfg.awsRegion }));
  }

  async recognize(
    image: Uint8Array,
    pageNumber: number,
  ): Promise<OcrPageResult> {
    if (image.byteLength > MAX_BYTES) {
      throw new Error(
        `La página ${pageNumber} supera 10 MB; baja OCR_RENDER_DPI para Textract`,
      );
    }
    const Document = { Bytes: image };
    const out =
      this.cfg.textractMode === 'analyze'
        ? await this.getClient().send(
            new AnalyzeDocumentCommand({
              Document,
              FeatureTypes: ['FORMS', 'TABLES'],
            }),
          )
        : await this.getClient().send(
            new DetectDocumentTextCommand({ Document }),
          );
    return mapTextractBlocks(out.Blocks, pageNumber);
  }
}
