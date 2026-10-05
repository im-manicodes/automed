/** Caja normalizada (0..1) respecto al tamaño de la página. */
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
  words: OcrWord[];
}

/** Motor OCR intercambiable (OCR_ENGINE=local|textract). Implementaciones en fase 4. */
export interface OcrEngine {
  recognize(image: Uint8Array, pageNumber: number): Promise<OcrPageResult>;
}

export const OCR_ENGINE = Symbol('OCR_ENGINE');
