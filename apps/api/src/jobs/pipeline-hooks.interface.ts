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
  process(attachmentId: string): Promise<void>;
}
export const ATTACHMENT_PROCESSOR = Symbol('ATTACHMENT_PROCESSOR');

/** Fase 5: arma el prompt (texto del hilo + OCR), llama a `LlmProvider` y guarda `Synthesis`. */
export interface ThreadSynthesizer {
  synthesize(threadId: string): Promise<void>;
}
export const THREAD_SYNTHESIZER = Symbol('THREAD_SYNTHESIZER');
