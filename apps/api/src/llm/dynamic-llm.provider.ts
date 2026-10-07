import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { AiSettingsService } from '../settings/ai-settings.service';
import type { AiEffectiveConfig } from '../settings/ai-settings.service';
import { createLlmProvider } from './llm-provider.factory';
import type {
  LlmCallOptions,
  LlmProvider,
  LlmRequest,
  LlmTask,
} from './llm-provider.interface';

/**
 * Proveedor LLM configurable en caliente: en cada llamada lee la configuración vigente
 * (panel > .env), elige el modelo por tarea y delega en el adaptador del proveedor activo.
 * El adaptador se reutiliza mientras no cambien proveedor, clave, URL, región ni timeouts.
 */
@Injectable()
export class DynamicLlmProvider implements LlmProvider {
  private cached: { key: string; adapter: LlmProvider } | null = null;

  constructor(private readonly settings: AiSettingsService) {}

  private adapterFor(eff: AiEffectiveConfig): LlmProvider {
    const c = eff.llm;
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          c.provider,
          c.provider === 'openai' ? c.openaiApiKey : null,
          c.provider === 'anthropic' ? c.anthropicApiKey : null,
          c.provider === 'ollama' ? c.ollamaBaseUrl : null,
          c.provider === 'bedrock' ? c.awsRegion : null,
          c.provider === 'bedrock' ? (c.awsCredentials ?? null) : null,
          c.timeoutMs,
          c.maxRetries,
          c.retryBaseMs,
          c.defaultMaxTokens,
          c.temperature,
        ]),
      )
      .digest('hex');
    if (!this.cached || this.cached.key !== key) {
      this.cached = { key, adapter: createLlmProvider(c) };
    }
    return this.cached.adapter;
  }

  modelFor(task: LlmTask): Promise<string> {
    return this.settings.modelFor(task);
  }

  async complete(request: LlmRequest): Promise<string> {
    const eff = await this.settings.getEffective();
    const task: LlmTask =
      request.task ?? (request.images?.length ? 'vision' : 'resumen');
    const model = request.model ?? eff.modelos[task];
    return this.adapterFor(eff).complete({ ...request, task, model });
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
      task: 'vision',
      ...rest,
    });
  }
}
