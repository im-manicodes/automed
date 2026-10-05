/** Caja normalizada (0..1) respecto al tamaño de la página; origen arriba a la izquierda. */
export interface OcrBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrWord {
  text: string;
  confidence: number; // 0..1
  box: OcrBox;
}

export interface OcrPageResult {
  pageNumber: number;
  /** Palabras (si el motor las entrega; PaddleOCR solo entrega líneas). */
  words: OcrWord[];
  /** Líneas de texto (unidad de región para revisión). Si falta, se usan `words`. */
  lines?: OcrWord[];
}

/** Motor OCR intercambiable (OCR_ENGINE=local|textract). */
export interface OcrEngine {
  readonly name: string;
  recognize(image: Uint8Array, pageNumber: number): Promise<OcrPageResult>;
}

export const OCR_ENGINE = Symbol('OCR_ENGINE');
