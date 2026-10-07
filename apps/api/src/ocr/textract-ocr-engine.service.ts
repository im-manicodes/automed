import {
  AnalyzeDocumentCommand,
  DetectDocumentTextCommand,
  TextractClient,
} from '@aws-sdk/client-textract';
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiSettingsService } from '../settings/ai-settings.service';
import type { OcrEngine, OcrPageResult } from './ocr-engine.interface';
import { OcrConfig, readOcrConfig } from './ocr-config';
import { mapTextractBlocks } from './textract-mapper';

/** Límite de Textract para documentos síncronos en bytes (PNG/JPEG). */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * AWS Textract (SDK v3). DetectDocumentText lee impreso y manuscrito; con
 * TEXTRACT_MODE=analyze usa AnalyzeDocument (FORMS+TABLES). Credenciales: las del panel
 * (`AiSettingsService.getAwsCredentials`) si existen; si no, la cadena estándar de AWS
 * (variables de entorno / rol IAM). El cliente se recrea al cambiar credenciales o región
 * (la región es la de la configuración de IA: panel > AWS_REGION).
 */
@Injectable()
export class TextractOcrEngineService implements OcrEngine {
  readonly name = 'textract';
  private readonly cfg: OcrConfig;
  private client?: { key: string; client: TextractClient };

  constructor(
    config: ConfigService,
    private readonly ai: AiSettingsService,
  ) {
    this.cfg = readOcrConfig(config);
  }

  private async getClient(): Promise<TextractClient> {
    const region =
      (await this.ai.getEffective()).awsRegion || this.cfg.awsRegion;
    const creds = await this.ai.getAwsCredentials();
    const key = createHash('sha256')
      .update(JSON.stringify([region, creds ?? null]))
      .digest('hex');
    if (this.client?.key !== key) {
      this.client = {
        key,
        client: new TextractClient({
          region,
          ...(creds ? { credentials: creds } : {}),
        }),
      };
    }
    return this.client.client;
  }

  async recognize(
    image: Uint8Array,
    pageNumber: number,
    opts: { mode?: 'detect' | 'analyze' } = {},
  ): Promise<OcrPageResult> {
    if (image.byteLength > MAX_BYTES) {
      throw new Error(
        `La página ${pageNumber} supera 10 MB; baja OCR_RENDER_DPI para Textract`,
      );
    }
    const Document = { Bytes: image };
    const client = await this.getClient();
    const out =
      (opts.mode ?? this.cfg.textractMode) === 'analyze'
        ? await client.send(
            new AnalyzeDocumentCommand({
              Document,
              FeatureTypes: ['FORMS', 'TABLES'],
            }),
          )
        : await client.send(new DetectDocumentTextCommand({ Document }));
    return mapTextractBlocks(out.Blocks, pageNumber);
  }
}
