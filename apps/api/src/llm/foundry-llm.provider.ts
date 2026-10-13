import OpenAI from 'openai';
import { BaseLlmProvider } from './base-llm.provider';
import { reasoningHeadroom, type LlmConfig } from './llm-config';
import { LlmTruncatedError } from './llm-provider.interface';
import type { LlmRequest, LlmResult } from './llm-provider.interface';
import { usageFromOpenAi } from './usage-extract';

/**
 * Microsoft Foundry (Azure) vía su API v1 compatible con OpenAI. `baseURL` = endpoint del recurso
 * (`https://<recurso>.openai.azure.com/openai/v1`), autenticación con clave API (cabecera `api-key`)
 * y el «modelo» es el nombre del deployment. Usa `max_completion_tokens` y NUNCA envía `temperature`
 * (el nombre del deployment es arbitrario: no se sabe si el modelo la acepta).
 */
export class FoundryLlmProvider extends BaseLlmProvider {
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
        apiKey: cfg.foundryApiKey || 'foundry', // el SDK exige un valor; la auth real va en `api-key`
        baseURL: cfg.foundryEndpoint,
        defaultHeaders: { 'api-key': cfg.foundryApiKey || '' },
        maxRetries: 0,
        timeout: cfg.timeoutMs,
      });
  }

  protected async call(
    req: LlmRequest,
    model: string,
    maxTokens: number,
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
      max_completion_tokens: maxTokens + reasoningHeadroom(model),
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
