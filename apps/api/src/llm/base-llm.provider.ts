import type { LlmConfig } from './llm-config';
import { modelAcceptsTemperature } from './llm-config';
import type {
  LlmCallOptions,
  LlmProvider,
  LlmRequest,
} from './llm-provider.interface';
import { withRetry } from './llm-retry';

/**
 * Base de los adaptadores: elige modelo (texto/visión), aplica reintentos con backoff y
 * resuelve temperatura/max tokens. Los adaptadores solo implementan `call`.
 */
export abstract class BaseLlmProvider implements LlmProvider {
  readonly modelText: string;
  readonly modelVision: string;

  protected constructor(
    protected readonly cfg: LlmConfig,
    private readonly sleep?: (ms: number) => Promise<void>,
  ) {
    this.modelText = cfg.modelText;
    this.modelVision = cfg.modelVision;
  }

  /** Una llamada sin reintentos. `temperature` ya viene resuelta (undefined = no enviar). */
  protected abstract call(
    req: LlmRequest,
    model: string,
    maxTokens: number,
    temperature: number | undefined,
  ): Promise<string>;

  complete(request: LlmRequest): Promise<string> {
    const model = request.images?.length ? this.modelVision : this.modelText;
    const maxTokens = request.maxTokens ?? this.cfg.defaultMaxTokens;
    const t = request.temperature ?? this.cfg.temperature;
    const temperature = modelAcceptsTemperature(model) ? t : undefined;
    return withRetry(() => this.call(request, model, maxTokens, temperature), {
      retries: this.cfg.maxRetries,
      baseMs: this.cfg.retryBaseMs,
      sleep: this.sleep,
    });
  }

  text(system: string, user: string, opts: LlmCallOptions = {}) {
    return this.complete({ system, prompt: user, ...opts });
  }

  vision(
    image: { mediaType: string; data: Uint8Array },
    instruction: string,
    opts: LlmCallOptions & { system?: string } = {},
  ) {
    const { system, ...rest } = opts;
    return this.complete({
      system,
      prompt: instruction,
      images: [image],
      ...rest,
    });
  }
}
