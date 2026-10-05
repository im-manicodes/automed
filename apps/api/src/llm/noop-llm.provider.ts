import type { LlmProvider, LlmRequest } from './llm-provider.interface';

/**
 * Proveedor mock (fase 4): no llama a ningún modelo y devuelve cadena vacía, de modo que el
 * reintento con visión no cambia nada. La fase 5 lo reemplaza por Bedrock/Anthropic/OpenAI.
 */
export class NoopLlmProvider implements LlmProvider {
  complete(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _request: LlmRequest,
  ): Promise<string> {
    return Promise.resolve('');
  }
}
