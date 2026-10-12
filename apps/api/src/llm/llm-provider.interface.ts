/** Tarea para la que se usa el LLM; el modelo se elige por tarea (ver AiSettingsService). */
export type LlmTask =
  | 'resumen'
  | 'whatsapp'
  | 'evento'
  | 'reporte'
  | 'vision'
  | 'vision_respaldo'
  | 'vision_sugerencias';

export const LLM_TASKS: readonly LlmTask[] = [
  'resumen',
  'whatsapp',
  'evento',
  'reporte',
  'vision',
  'vision_respaldo',
  'vision_sugerencias',
];

export interface LlmRequest {
  system?: string;
  prompt: string;
  /** Imágenes opcionales (p. ej. recortes para re-lectura con visión). Usa el modelo de visión. */
  images?: { mediaType: string; data: Uint8Array }[];
  maxTokens?: number;
  /** Temperatura baja por defecto; se omite en modelos que no aceptan muestreo. */
  temperature?: number;
  /** Tarea (elige el modelo en el proveedor dinámico). */
  task?: LlmTask;
  /** Modelo explícito para esta petición (tiene prioridad sobre el defecto texto/visión). */
  model?: string;
  /** Lanza LlmTruncatedError si el modelo se detiene por límite de tokens de salida. */
  failOnTruncate?: boolean;
}

export interface LlmCallOptions {
  maxTokens?: number;
  temperature?: number;
  task?: LlmTask;
  /** Lanza LlmTruncatedError si la salida se corta por límite de tokens. */
  failOnTruncate?: boolean;
}

/** La salida del modelo se cortó por el límite de tokens de salida. */
export class LlmTruncatedError extends Error {
  constructor(
    message = 'La salida del modelo se cortó por el límite de tokens',
  ) {
    super(message);
    this.name = 'LlmTruncatedError';
  }
}

/** Proveedor LLM intercambiable (ollama | openai | anthropic | bedrock | foundry). */
export interface LlmProvider {
  /** Modelo que se usa para la tarea (se guarda, p. ej., en Synthesis.model). */
  modelFor(task: LlmTask): Promise<string>;
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
