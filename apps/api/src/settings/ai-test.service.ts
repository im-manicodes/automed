import { BadRequestException, Injectable } from '@nestjs/common';
import { DEFAULT_MODELS } from '../llm/llm-config';
import type { LlmProviderName } from '../llm/llm-config';
import { createLlmProvider } from '../llm/llm-provider.factory';
import { AI_PROVIDERS, AiSettingsService } from './ai-settings.service';

export interface AiTestDraft {
  proveedor?: LlmProviderName;
  modelo?: string;
  claveOpenai?: string;
  claveAnthropic?: string;
  claveFoundry?: string;
  foundryEndpoint?: string;
  ollamaUrl?: string;
  awsRegion?: string;
  claveAwsAccessKeyId?: string;
  claveAwsSecreto?: string;
}

export interface AiTestResult {
  ok: boolean;
  ms: number;
  mensaje: string;
}

const TEST_TIMEOUT_MS = 20_000;

/** Traduce un error del proveedor a un mensaje seguro (sin claves ni cuerpos de respuesta). */
export function mapTestError(err: unknown): string {
  const e = (err ?? {}) as {
    status?: number;
    name?: string;
    code?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const status = e.status ?? e.$metadata?.httpStatusCode;
  const name = String(e.name ?? '');
  const msg = String(e.message ?? '').toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    /AccessDenied|UnrecognizedClient|InvalidSignature|ExpiredToken|Credential/i.test(
      name,
    )
  ) {
    return 'La clave no es válida o no tiene permiso.';
  }
  if (status === 429 || /Throttling|TooManyRequests/i.test(name)) {
    return 'El proveedor limitó las peticiones; intenta en un minuto.';
  }
  if (status === 404 || /ResourceNotFound/i.test(name) || /model/.test(msg)) {
    return 'No existe ese modelo en este proveedor.';
  }
  if (
    /abort|timeout|timedout/i.test(name) ||
    /ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(
      String(e.code ?? ''),
    ) ||
    /fetch failed|timed out|timeout|network|connect|econn|enotfound/.test(msg)
  ) {
    return 'No se pudo conectar con el proveedor.';
  }
  return 'No se pudo probar la conexión.';
}

const str = (v: unknown, label: string, max: number): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || v.length > max) {
    throw new BadRequestException(`${label} no es válido`);
  }
  return v.trim();
};

@Injectable()
export class AiTestService {
  constructor(private readonly ai: AiSettingsService) {}

  /** Una llamada mínima con la configuración vigente + borrador (el borrador no se guarda). */
  async test(body: unknown): Promise<AiTestResult> {
    if (body !== undefined && body !== null) {
      if (typeof body !== 'object' || Array.isArray(body)) {
        throw new BadRequestException('Datos no válidos');
      }
    }
    const d = (body ?? {}) as Record<string, unknown>;
    const proveedor = d.proveedor as LlmProviderName | undefined;
    if (proveedor !== undefined && !AI_PROVIDERS.includes(proveedor)) {
      throw new BadRequestException(
        'Proveedor no válido (ollama, openai, anthropic, bedrock o foundry)',
      );
    }
    const modelo = str(d.modelo, 'El modelo', 200);
    const claveOpenai = str(d.claveOpenai, 'La clave de OpenAI', 500);
    const claveAnthropic = str(d.claveAnthropic, 'La clave de Anthropic', 500);
    const claveFoundry = str(d.claveFoundry, 'La clave de Foundry', 500);
    const foundryEndpoint = str(
      d.foundryEndpoint,
      'La dirección de Foundry',
      500,
    );
    const ollamaUrl = str(d.ollamaUrl, 'La dirección de Ollama', 500);
    const awsRegion = str(d.awsRegion, 'La región de AWS', 50);
    const awsId = str(d.claveAwsAccessKeyId, 'La clave de acceso de AWS', 128);
    const awsSecret = str(d.claveAwsSecreto, 'El secreto de AWS', 500);
    if ((awsId === undefined) !== (awsSecret === undefined)) {
      throw new BadRequestException(
        'Las claves de AWS van juntas: indica la clave de acceso y el secreto',
      );
    }
    if (ollamaUrl) {
      let ok = false;
      try {
        const u = new URL(ollamaUrl);
        ok = u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        ok = false;
      }
      if (!ok) {
        throw new BadRequestException(
          'La dirección de Ollama debe empezar con http:// o https://',
        );
      }
    }

    if (foundryEndpoint) {
      let ok = false;
      try {
        const u = new URL(foundryEndpoint);
        ok = u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        ok = false;
      }
      if (!ok) {
        throw new BadRequestException(
          'La dirección de Foundry debe empezar con http:// o https://',
        );
      }
    }

    const eff = await this.ai.getEffective();
    const provider = proveedor ?? eff.proveedor;
    const model =
      modelo ??
      (provider === eff.proveedor
        ? eff.modelos.resumen
        : DEFAULT_MODELS[provider]);
    const llm = {
      ...eff.llm,
      provider,
      modelText: model,
      modelVision: model,
      openaiApiKey: claveOpenai ?? eff.llm.openaiApiKey,
      anthropicApiKey: claveAnthropic ?? eff.llm.anthropicApiKey,
      foundryApiKey: claveFoundry ?? eff.llm.foundryApiKey,
      foundryEndpoint: foundryEndpoint ?? eff.llm.foundryEndpoint,
      ollamaBaseUrl: ollamaUrl ?? eff.llm.ollamaBaseUrl,
      awsRegion: awsRegion ?? eff.llm.awsRegion,
      awsCredentials:
        awsId && awsSecret
          ? { accessKeyId: awsId, secretAccessKey: awsSecret }
          : eff.llm.awsCredentials,
      timeoutMs: TEST_TIMEOUT_MS,
      maxRetries: 0,
    };

    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      const adapter = createLlmProvider(llm);
      await Promise.race([
        adapter.complete({
          system: 'Responde solo: OK',
          prompt: 'Responde solo: OK',
          maxTokens: 16,
          model,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
              ),
            TEST_TIMEOUT_MS + 2000,
          );
        }),
      ]);
      return { ok: true, ms: Date.now() - started, mensaje: 'Funciona.' };
    } catch (err) {
      return {
        ok: false,
        ms: Date.now() - started,
        mensaje: mapTestError(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
