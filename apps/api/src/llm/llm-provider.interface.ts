export interface LlmRequest {
  system?: string;
  prompt: string;
  /** Imágenes opcionales (p. ej. recortes para re-lectura con visión). Usa el modelo de visión. */
  images?: { mediaType: string; data: Uint8Array }[];
  maxTokens?: number;
  /** Temperatura baja por defecto; se omite en modelos que no aceptan muestreo. */
  temperature?: number;
}

export interface LlmCallOptions {
  maxTokens?: number;
  temperature?: number;
}

/** Proveedor LLM intercambiable (LLM_PROVIDER=anthropic|openai|bedrock). */
export interface LlmProvider {
  /** Modelo usado para texto (se guarda en Synthesis.model). */
  readonly modelText: string;
  readonly modelVision: string;
  complete(request: LlmRequest): Promise<string>;
  /** Texto: system + user, temperatura baja. */
  text(system: string, user: string, opts?: LlmCallOptions): Promise<string>;
  /** Visión: una imagen + instrucción (p. ej. releer un recorte OCR dudoso). */
  vision(
    image: { mediaType: string; data: Uint8Array },
    instruction: string,
    opts?: LlmCallOptions & { system?: string },
  ): Promise<string>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
