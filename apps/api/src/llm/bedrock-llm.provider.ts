import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  ContentBlock,
  ImageFormat,
} from '@aws-sdk/client-bedrock-runtime';
import { BaseLlmProvider } from './base-llm.provider';
import type { LlmConfig } from './llm-config';
import type { LlmRequest } from './llm-provider.interface';

const FORMATS: Record<string, ImageFormat> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Bedrock vía API Converse. Usa las credenciales explícitas de la configuración (panel) si existen;
 * si no, la cadena por defecto de AWS (rol/perfil/variables).
 */
export class BedrockLlmProvider extends BaseLlmProvider {
  private readonly client: Pick<BedrockRuntimeClient, 'send'>;

  constructor(
    cfg: LlmConfig,
    client?: Pick<BedrockRuntimeClient, 'send'>,
    sleep?: (ms: number) => Promise<void>,
  ) {
    super(cfg, sleep);
    this.client =
      client ??
      new BedrockRuntimeClient({
        region: cfg.awsRegion,
        ...(cfg.awsCredentials ? { credentials: cfg.awsCredentials } : {}),
      });
  }

  protected async call(
    req: LlmRequest,
    model: string,
    maxTokens: number,
    temperature: number | undefined,
  ): Promise<string> {
    const content: ContentBlock[] = [
      ...(req.images ?? []).map((img): ContentBlock => ({
        image: {
          format: FORMATS[img.mediaType] ?? 'png',
          source: { bytes: img.data },
        },
      })),
      { text: req.prompt },
    ];
    const res = await this.client.send(
      new ConverseCommand({
        modelId: model,
        ...(req.system ? { system: [{ text: req.system }] } : {}),
        messages: [{ role: 'user', content }],
        inferenceConfig: {
          maxTokens,
          ...(temperature !== undefined ? { temperature } : {}),
        },
      }),
      { abortSignal: AbortSignal.timeout(this.cfg.timeoutMs) },
    );
    return (res.output?.message?.content ?? [])
      .map((b) => b.text ?? '')
      .join('')
      .trim();
  }
}
