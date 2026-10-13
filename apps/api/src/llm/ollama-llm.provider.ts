import OpenAI from 'openai';
import { BaseLlmProvider } from './base-llm.provider';
import type { LlmConfig } from './llm-config';
import { LlmTruncatedError } from './llm-provider.interface';
import type { LlmRequest, LlmResult } from './llm-provider.interface';
import { usageFromOpenAi } from './usage-extract';

/**
 * Ollama (solo desarrollo/pruebas) vía su API compatible con OpenAI. No requiere API key
 * (se envía una ficticia). Usa `max_tokens` (Ollama no entiende `max_completion_tokens`).
 */
export class OllamaLlmProvider extends BaseLlmProvider {
  private readonly client: OpenAI;

  constructor(
    cfg: LlmConfig,
    client?: OpenAI,
    sleep?: (ms: number) => Promise<void>,
  ) {
    super(cfg, sleep);
    this.client =
      client ??
      new OpenAI({
        apiKey: 'ollama',
        baseURL: cfg.ollamaBaseUrl,
        maxRetries: 0,
        timeout: cfg.timeoutMs,
      });
  }

  protected async call(
    req: LlmRequest,
    model: string,
    maxTokens: number,
    temperature: number | undefined,
  ): Promise<LlmResult> {
    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      ...(req.images ?? []).map(
        (img): OpenAI.Chat.Completions.ChatCompletionContentPart => ({
          type: 'image_url',
          image_url: {
            url: `data:${img.mediaType};base64,${Buffer.from(img.data).toString('base64')}`,
          },
        }),
      ),
      { type: 'text', text: req.prompt },
    ];
    const res = await this.client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      messages: [
        ...(req.system
          ? [{ role: 'system' as const, content: req.system }]
          : []),
        { role: 'user' as const, content: userContent },
      ],
    });
    if (req.failOnTruncate && res.choices[0]?.finish_reason === 'length') {
      throw new LlmTruncatedError();
    }
    return {
      text: (res.choices[0]?.message?.content ?? '').trim(),
      usage: usageFromOpenAi(res.usage),
    };
  }
}
