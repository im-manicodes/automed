/**
 * Puntos de enganche del pipeline. Las fases 4 y 5 sustituyen los providers por defecto
 * (no-op) en JobsModule por implementaciones reales.
 */

/**
 * Fase 4: rasteriza el PDF, llama a `OcrEngine`, guarda OcrPage/OcrRegion (regiones dudosas
 * con status `dudoso`). El pipeline decide después `listo` / `necesita_revision` contando
 * las regiones dudosas; el procesador no toca el estado del Attachment.
 */
export interface AttachmentProcessor {
  /**
   * `shouldContinue` (opcional): punto de control de cancelación. Si devuelve false el
   * procesador lanza `CancelledError` sin persistir nada (no quedan OcrPage a medias).
   */
  process(
    attachmentId: string,
    opts?: { shouldContinue?: () => Promise<boolean> },
  ): Promise<void>;
}
export const ATTACHMENT_PROCESSOR = Symbol('ATTACHMENT_PROCESSOR');

/**
 * Fase 5: síntesis incremental. Con síntesis previa solo envía al LLM la síntesis anterior + novedades
 * (mensajes nuevos con OCR de sus adjuntos, o el documento corregido); `force` = modo completo.
 * Arma el prompt (texto del hilo + OCR), llama a `LlmProvider` y guarda `Synthesis`. */
export interface ThreadSynthesizer {
  synthesize(
    threadId: string,
    opts?: {
      force?: boolean;
      correctedSha256?: string;
      reanalyzeMessageId?: string;
    },
  ): Promise<void>;
}
export const THREAD_SYNTHESIZER = Symbol('THREAD_SYNTHESIZER');
