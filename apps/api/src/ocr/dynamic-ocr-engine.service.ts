import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OcrSettingsService } from '../settings/ocr-settings.service';
import { AzureOcrEngineService } from './azure-ocr-engine.service';
import { LocalOcrEngineService } from './local-ocr-engine.service';
import { readOcrConfig } from './ocr-config';
import type { OcrEngine, OcrPageResult } from './ocr-engine.interface';
import { TextractOcrEngineService } from './textract-ocr-engine.service';

export const OCR_NOT_CONFIGURED_MESSAGE =
  'Configura el OCR en Ajustes para leer páginas escaneadas.';

/**
 * Motor OCR elegible en caliente: en cada página resuelve el motor vigente (panel > .env)
 * y delega en el adaptador local, Textract o Azure. Con `ninguno` falla con un mensaje claro;
 * el pipeline lo convierte en el estado de error del hilo (los PDFs digitales no llegan aquí).
 */
@Injectable()
export class DynamicOcrEngine implements OcrEngine {
  private last: 'local' | 'textract' | 'azure' = 'local';

  constructor(
    private readonly config: ConfigService,
    private readonly settings: OcrSettingsService,
    private readonly local: LocalOcrEngineService,
    private readonly textract: TextractOcrEngineService,
    private readonly azure: AzureOcrEngineService,
  ) {}

  /** Nombre del último motor usado (se guarda en OcrPage.engine). */
  get name(): string {
    return this.last;
  }

  private localUrl(): string {
    return readOcrConfig(this.config).localUrl;
  }

  async recognize(
    image: Uint8Array,
    pageNumber: number,
  ): Promise<OcrPageResult> {
    const eff = await this.settings.getEffective();
    if (eff.motor === 'ninguno') throw new Error(OCR_NOT_CONFIGURED_MESSAGE);
    if (eff.motor === 'textract') {
      this.last = 'textract';
      return this.textract.recognize(image, pageNumber, {
        mode: eff.textractMode,
      });
    }
    if (eff.motor === 'azure') {
      this.last = 'azure';
      return this.azure.recognize(image, pageNumber);
    }
    this.last = 'local';
    return this.local.recognize(image, pageNumber, {
      baseUrl: this.localUrl(),
    });
  }
}
