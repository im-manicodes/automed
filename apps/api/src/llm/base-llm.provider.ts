import type { LlmConfig } from './llm-config';
import { modelAcceptsTemperature } from './llm-config';
import type {
  LlmCallOptions,
  LlmProvider,
  LlmRequest,
  LlmResult,
  LlmTask,
} from './llm-provider.interface';
import { withRetry } from './llm-retry';

/**
 * Base de los adaptadores: elige modelo (texto/visión), aplica reintentos con backoff y
 * acepta un modelo por petición y resuelve temperatura/max tokens. Los adaptadores solo implementan `call`.
 */
export abstract class BaseLlmProvider implements LlmProvider {
  protected constructor(
    protected readonly cfg: LlmConfig,
    private readonly sleep?: (ms: number) => Promise<void>,
  ) {}

  modelFor(task: LlmTask): Promise<string> {
    return Promise.resolve(
      task === 'vision' ||
        task === 'vision_respaldo' ||
        task === 'vision_sugerencias'
        ? this.cfg.modelVision
        : this.cfg.modelText,
    );
  }

  /**
   * Una llamada sin reintentos. `temperature` ya viene resuelta (undefined = no enviar).
   * Devuelve el texto o `{ text, usage }` si el proveedor informó el uso.
   */
  protected abstract call(
    req: LlmRequest,
    model: string,
    maxTokens: number,
    temperature: number | undefined,
  ): Promise<string | LlmResult>;

  async complete(request: LlmRequest): Promise<string> {
    return (await this.completeDetailed(request)).text;
  }

  /** Texto + uso de la llamada que tuvo éxito (los intentos fallidos no informan uso). */
  async completeDetailed(request: LlmRequest): Promise<LlmResult> {
    const model =
      request.model ??
      (request.images?.length ? this.cfg.modelVision : this.cfg.modelText);
    const maxTokens = request.maxTokens ?? this.cfg.defaultMaxTokens;
    const t = request.temperature ?? this.cfg.temperature;
    const temperature = modelAcceptsTemperature(model) ? t : undefined;
    const out = await withRetry(
      () => this.call(request, model, maxTokens, temperature),
      {
        retries: this.cfg.maxRetries,
        baseMs: this.cfg.retryBaseMs,
        sleep: this.sleep,
      },
    );
    return typeof out === 'string' ? { text: out } : out;
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
