import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmModule } from '../llm/llm.module';
import { ATTACHMENT_PROCESSOR } from '../jobs/pipeline-hooks.interface';
import { LocalOcrEngineService } from './local-ocr-engine.service';
import { OCR_ENGINE } from './ocr-engine.interface';
import { OcrService } from './ocr.service';
import { PdfRasterizerService } from './pdf-rasterizer.service';
import { TextractOcrEngineService } from './textract-ocr-engine.service';
import { VisionRetryService } from './vision-retry.service';
import { readOcrConfig } from './ocr-config';

@Module({
  imports: [LlmModule],
  providers: [
    PdfRasterizerService,
    LocalOcrEngineService,
    TextractOcrEngineService,
    VisionRetryService,
    OcrService,
    {
      provide: OCR_ENGINE,
      inject: [ConfigService, LocalOcrEngineService, TextractOcrEngineService],
      useFactory: (
        config: ConfigService,
        local: LocalOcrEngineService,
        textract: TextractOcrEngineService,
      ) => (readOcrConfig(config).engine === 'textract' ? textract : local),
    },
    { provide: ATTACHMENT_PROCESSOR, useExisting: OcrService },
  ],
  exports: [ATTACHMENT_PROCESSOR, OCR_ENGINE, PdfRasterizerService],
})
export class OcrModule {}
