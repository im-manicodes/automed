import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';
import { LLM_PROVIDER } from './llm-provider.interface';
import { readLlmConfig } from './llm-config';
import { createLlmProvider } from './llm-provider.factory';

@Module({
  providers: [
    LlmService,
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createLlmProvider(readLlmConfig(config)),
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
