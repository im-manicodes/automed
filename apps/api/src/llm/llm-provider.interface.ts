export interface LlmRequest {
  system?: string;
  prompt: string;
  /** Imágenes opcionales (p. ej. recortes para re-lectura con visión). */
  images?: { mediaType: string; data: Uint8Array }[];
  maxTokens?: number;
}

/** Proveedor LLM intercambiable (LLM_PROVIDER=bedrock|anthropic|openai). Implementaciones en fase 5. */
export interface LlmProvider {
  complete(request: LlmRequest): Promise<string>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
