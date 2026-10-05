import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LLM_PROVIDER } from './llm-provider.interface';
import { NoopLlmProvider } from './noop-llm.provider';

@Module({
  providers: [
    LlmService,
    // Fase 5: sustituir por la implementación real según LLM_PROVIDER.
    { provide: LLM_PROVIDER, useClass: NoopLlmProvider },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
