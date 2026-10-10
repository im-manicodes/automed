import { Injectable } from '@nestjs/common';
import { OcrSettingsService } from '../settings/ocr-settings.service';
import { shrinkToJpeg } from './image-crop';
import { mapAzurePage, type AzurePage } from './azure-mapper';
import type { OcrEngine, OcrPageResult } from './ocr-engine.interface';

const API_VERSION = '2024-11-30';
const POLL_MS = 1000;
const TIMEOUT_MS = 120_000;
/** La capa gratuita (F0) acepta imágenes de hasta 4 MB (la de pago, 500 MB): se envía siempre menos. */
const MAX_BYTES = 3.8 * 1024 * 1024;

export const AZURE_NOT_CONFIGURED_MESSAGE =
  'Falta la dirección o la clave de Azure. Configúralas en Ajustes -> OCR.';

interface AnalyzeStatus {
  status?: 'notStarted' | 'running' | 'succeeded' | 'failed';
  analyzeResult?: { pages?: AzurePage[] };
  error?: { code?: string; message?: string };
}

/**
 * Azure AI Document Intelligence, modelo `prebuilt-read` (impreso y manuscrito). Equivalente a
 * Textract: se envía la imagen de la página, se espera la operación asíncrona y se mapean
 * palabras y líneas a cajas normalizadas. Credenciales: las del panel (`ocr.config`, clave
 * cifrada) o AZURE_OCR_ENDPOINT / AZURE_OCR_KEY. Usa `fetch` (sin SDK adicional).
 */
@Injectable()
export class AzureOcrEngineService implements OcrEngine {
  readonly name = 'azure';

  constructor(private readonly settings: OcrSettingsService) {}

  async recognize(
    image: Uint8Array,
    pageNumber: number,
  ): Promise<OcrPageResult> {
    const creds = await this.settings.getAzureCredentials();
    if (!creds) throw new Error(AZURE_NOT_CONFIGURED_MESSAGE);
    // Una página rasterizada puede pasar de 4 MB: se recomprime (JPEG) antes de enviarla.
    const body =
      image.byteLength > MAX_BYTES
        ? await shrinkToJpeg(image, MAX_BYTES)
        : image;
    const base = creds.endpoint.replace(/\/+$/, '');
    const headers = { 'Ocp-Apim-Subscription-Key': creds.key };
    const deadline = Date.now() + TIMEOUT_MS;
    const start = await fetch(
      `${base}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=${API_VERSION}`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/octet-stream' },
        body: body as BodyInit,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!start.ok) throw await azureError(start);
    const op = start.headers.get('operation-location');
    if (!op) throw new Error('Azure no devolvió la operación de lectura');
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const res = await fetch(op, {
        headers,
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      });
      if (!res.ok) throw await azureError(res);
      const body = (await res.json()) as AnalyzeStatus;
      if (body.status === 'succeeded') {
        return mapAzurePage(body.analyzeResult?.pages?.[0], pageNumber);
      }
      if (body.status === 'failed') {
        throw new Error(
          `Azure no pudo leer la página ${pageNumber}${body.error?.code ? ` (${body.error.code})` : ''}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Azure tardó demasiado en leer la página ${pageNumber}`,
        );
      }
    }
  }
}

/** Error legible sin incluir contenido ni la clave. */
export async function azureError(res: Response): Promise<Error> {
  let code = '';
  try {
    const j = (await res.json()) as {
      error?: { code?: string; innererror?: { code?: string } };
    };
    // Códigos de Azure (p. ej. InvalidRequest/InvalidContentLength): nunca incluyen contenido.
    code = [j.error?.code, j.error?.innererror?.code].filter(Boolean).join('/');
  } catch {
    /* sin cuerpo JSON */
  }
  return Object.assign(
    new Error(`Azure respondió ${res.status}${code ? ` (${code})` : ''}`),
    { status: res.status, code },
  );
}
