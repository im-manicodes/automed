import { AnthropicLlmProvider } from './anthropic-llm.provider';
import { BedrockLlmProvider } from './bedrock-llm.provider';
import type { LlmConfig } from './llm-config';
import type { LlmProvider } from './llm-provider.interface';
import { OpenAiLlmProvider } from './openai-llm.provider';

/** Selecciona el adaptador según LLM_PROVIDER. */
export function createLlmProvider(cfg: LlmConfig): LlmProvider {
  switch (cfg.provider) {
    case 'bedrock':
      return new BedrockLlmProvider(cfg);
    case 'openai':
      return new OpenAiLlmProvider(cfg);
    default:
      return new AnthropicLlmProvider(cfg);
  }
}
