import Anthropic from '@anthropic-ai/sdk';
import { BaseLlmProvider } from './base-llm.provider';
import type { LlmConfig } from './llm-config';
import { LlmTruncatedError } from './llm-provider.interface';
import type { LlmRequest } from './llm-provider.interface';

type ImageMedia = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export class AnthropicLlmProvider extends BaseLlmProvider {
  private readonly client: Anthropic;

  constructor(
    cfg: LlmConfig,
    client?: Anthropic,
    sleep?: (ms: number) => Promise<void>,
  ) {
    super(cfg, sleep);
    // Los reintentos los hace withRetry (maxRetries del SDK en 0 para no multiplicarlos).
    this.client =
      client ??
      new Anthropic({
        apiKey: cfg.anthropicApiKey,
        maxRetries: 0,
        timeout: cfg.timeoutMs,
      });
  }

  protected async call(
    req: LlmRequest,
    model: string,
    maxTokens: number,
    temperature: number | undefined,
  ): Promise<string> {
    const content: Anthropic.ContentBlockParam[] = [
      ...(req.images ?? []).map((img): Anthropic.ImageBlockParam => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType as ImageMedia,
          data: Buffer.from(img.data).toString('base64'),
        },
      })),
      { type: 'text', text: req.prompt },
    ];
    const res = await this.client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        ...(req.system ? { system: req.system } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        messages: [{ role: 'user', content }],
      },
      { timeout: this.cfg.timeoutMs },
    );
    if (res.stop_reason === 'refusal') {
      throw new Error('El modelo rechazó la solicitud (refusal)');
    }
    if (req.failOnTruncate && res.stop_reason === 'max_tokens') {
      throw new LlmTruncatedError();
    }
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  }
}
