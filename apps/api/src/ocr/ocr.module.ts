import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { ATTACHMENT_PROCESSOR } from '../jobs/pipeline-hooks.interface';
import { LocalOcrEngineService } from './local-ocr-engine.service';
import { OCR_ENGINE } from './ocr-engine.interface';
import { OcrService } from './ocr.service';
import { PdfRasterizerService } from './pdf-rasterizer.service';
import { TextractOcrEngineService } from './textract-ocr-engine.service';
import { VisionRetryService } from './vision-retry.service';
import { PROCESS_RUNNER, defaultProcessRunner } from './process-runner';
import { OcrSettingsController } from '../settings/ocr-settings.controller';
import { SettingsModule } from '../settings/settings.module';
import { AuthModule } from '../auth/auth.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { PdfExtractClientService } from './pdf-extract-client.service';
import { DynamicOcrEngine } from './dynamic-ocr-engine.service';
import { PythonEnvService } from './python-env.service';
import { OcrLocalRunner } from './ocr-local-runner.service';
import { OcrProbeService } from './ocr-probe.service';

@Module({
  imports: [
    LlmModule,
    SettingsModule,
    AuthModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
  ],
  controllers: [OcrSettingsController],
  providers: [
    PdfRasterizerService,
    LocalOcrEngineService,
    TextractOcrEngineService,
    VisionRetryService,
    OcrService,
    { provide: OCR_ENGINE, useExisting: DynamicOcrEngine },
    { provide: PROCESS_RUNNER, useValue: defaultProcessRunner },
    { provide: ATTACHMENT_PROCESSOR, useExisting: OcrService },
    PdfExtractClientService,
    DynamicOcrEngine,
    PythonEnvService,
    OcrLocalRunner,
    OcrProbeService,
  ],
  exports: [
    ATTACHMENT_PROCESSOR,
    OCR_ENGINE,
    PdfRasterizerService,
    OcrLocalRunner,
    PythonEnvService,
  ],
})
export class OcrModule {}
