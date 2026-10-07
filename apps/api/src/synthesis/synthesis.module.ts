import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { LlmModule } from '../llm/llm.module';
import { TemplatesModule } from '../templates/templates.module';
import { SynthesisService } from './synthesis.service';
import { SynthesisController } from './synthesis.controller';

@Module({
  imports: [AuthModule, LlmModule, SettingsModule, TemplatesModule],
  providers: [SynthesisService],
  controllers: [SynthesisController],
  exports: [SynthesisService],
})
export class SynthesisModule {}
