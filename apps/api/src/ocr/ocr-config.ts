import type { ConfigService } from '@nestjs/config';

export interface OcrConfig {
  engine: 'local' | 'textract';
  /** Resolución de rasterizado (DPI). */
  dpi: number;
  /** Debajo de este valor (0..1) una región queda 'dudoso'. */
  confidenceThreshold: number;
  visionRetry: boolean;
  /** Una relectura con visión debe llegar a esta confianza para pasar a 'ok'. */
  visionAcceptThreshold: number;
  visionMaxRegions: number;
  localUrl: string;
  localTimeoutMs: number;
  textractMode: 'detect' | 'analyze';
  awsRegion: string;
  /** auto: PDFs digitales -> markdown sin OCR; off: todo por OCR. */
  pdfTextMode: 'auto' | 'off';
  pdfExtractUrl: string;
  pdfExtractTimeoutMs: number;
  pdfTextMinChars: number;
}

const num = (v: string | undefined, d: number) => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export function readOcrConfig(config: Pick<ConfigService, 'get'>): OcrConfig {
  const get = (k: string): string | undefined => config.get<string>(k);
  return {
    engine: get('OCR_ENGINE') === 'textract' ? 'textract' : 'local',
    dpi: num(get('OCR_RENDER_DPI'), 250),
    confidenceThreshold: num(get('OCR_CONFIDENCE_THRESHOLD'), 0.85),
    visionRetry: get('OCR_VISION_RETRY') === 'true',
    visionAcceptThreshold: num(get('OCR_VISION_ACCEPT_THRESHOLD'), 0.9),
    visionMaxRegions: num(get('OCR_VISION_MAX_REGIONS'), 30),
    localUrl: (get('OCR_LOCAL_URL') ?? 'http://localhost:8000').replace(
      /\/$/,
      '',
    ),
    localTimeoutMs: num(get('OCR_LOCAL_TIMEOUT_MS'), 120000),
    textractMode: get('TEXTRACT_MODE') === 'analyze' ? 'analyze' : 'detect',
    awsRegion: get('AWS_REGION') ?? 'us-east-1',
    pdfTextMode: get('PDF_TEXT_MODE') === 'off' ? 'off' : 'auto',
    pdfExtractUrl: (get('PDF_EXTRACT_URL') ?? 'http://localhost:8001').replace(
      /\/$/,
      '',
    ),
    pdfExtractTimeoutMs: num(get('PDF_EXTRACT_TIMEOUT_MS'), 60000),
    pdfTextMinChars: num(get('PDF_TEXT_MIN_CHARS'), 60),
  };
}
