import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsageService } from './usage.service';
import { UsageController } from './usage.controller';

/** Sin dependencias de LLM/OCR: lo importan LlmModule y OcrModule sin ciclos. */
@Module({
  imports: [AuthModule],
  providers: [UsageService],
  controllers: [UsageController],
  exports: [UsageService],
})
export class UsageModule {}
