import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { UsageModule } from '../usage/usage.module';
import { LlmService } from './llm.service';
import { LLM_PROVIDER } from './llm-provider.interface';
import { DynamicLlmProvider } from './dynamic-llm.provider';

@Module({
  imports: [SettingsModule, UsageModule],
  providers: [
    LlmService,
    DynamicLlmProvider,
    { provide: LLM_PROVIDER, useExisting: DynamicLlmProvider },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
