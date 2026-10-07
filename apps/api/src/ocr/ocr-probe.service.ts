import {
  DetectDocumentTextCommand,
  TextractClient,
} from '@aws-sdk/client-textract';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCanvas } from '@napi-rs/canvas';
import { AiSettingsService } from '../settings/ai-settings.service';
import { mapTestError } from '../settings/ai-test.service';
import { OcrSettingsService } from '../settings/ocr-settings.service';
import { isDesktop } from './app-mode';
import { readOcrConfig } from './ocr-config';
import { OcrLocalRunner } from './ocr-local-runner.service';
import type { LocalServiceStatus } from './ocr-local-runner.service';

export interface OcrProbeResult {
  ok: boolean;
  ms: number;
  mensaje: string;
}

const PROBE_TIMEOUT_MS = 20_000;
/** Health check corto para mostrar el estado del OCR local en la versión web (servidor). */
const STATUS_TIMEOUT_MS = 2500;
const SERVER_DOWN_MSG =
  'El servicio de OCR no responde. Revisa que el contenedor ocr-local esté en marcha.';
/** Textract acepta como respuesta "válida" estos errores: la autenticación ya pasó. */
const DOC_ERRORS = /BadDocument|UnsupportedDocument|InvalidParameter/i;

/** Prueba mínima del OCR elegido. Nunca incluye claves ni contenido en el mensaje. */
@Injectable()
export class OcrProbeService {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: OcrSettingsService,
    private readonly ai: AiSettingsService,
    private readonly runner: OcrLocalRunner,
  ) {}

  /** Imagen diminuta de prueba (blanca, con un texto) generada en memoria. */
  testImage(): Uint8Array {
    const canvas = createCanvas(240, 80);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 240, 80);
    ctx.fillStyle = '#000000';
    ctx.font = '32px sans-serif';
    ctx.fillText('Prueba', 20, 52);
    return canvas.toBuffer('image/png');
  }

  protected createTextract(
    region: string,
    credentials?: { accessKeyId: string; secretAccessKey: string },
  ) {
    return new TextractClient({
      region,
      ...(credentials ? { credentials } : {}),
    });
  }

  protected async checkHealth(url: string, timeoutMs = 5000) {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error('health');
    return (await res.json()) as {
      ok?: boolean;
      fallback_reason?: string | null;
    };
  }

  /**
   * Estado del servicio OCR local en la versión web (OCR_LOCAL_URL, p. ej. el contenedor ocr-local).
   * Health check corto; nunca lanza.
   */
  async serverLocalStatus(): Promise<LocalServiceStatus> {
    try {
      const h = await this.checkHealth(
        readOcrConfig(this.config).localUrl,
        STATUS_TIMEOUT_MS,
      );
      if (h.ok === false) throw new Error('unhealthy');
      return { estado: 'listo', fallbackReason: h.fallback_reason ?? null };
    } catch {
      return { estado: 'detenido', mensaje: SERVER_DOWN_MSG };
    }
  }

  async probe(): Promise<OcrProbeResult> {
    const t0 = Date.now();
    const done = (ok: boolean, mensaje: string): OcrProbeResult => ({
      ok,
      ms: Date.now() - t0,
      mensaje,
    });
    const { motor } = await this.settings.getEffective();
    if (motor === 'ninguno') {
      return done(
        false,
        'Todavía no elegiste cómo leer los PDFs escaneados. Elige una opción en Ajustes.',
      );
    }
    if (motor === 'textract') return this.probeTextract(done);
    return this.probeLocal(done);
  }

  private async probeTextract(
    done: (ok: boolean, m: string) => OcrProbeResult,
  ): Promise<OcrProbeResult> {
    try {
      const eff = await this.ai.getEffective();
      const creds = await this.ai.getAwsCredentials();
      const client = this.createTextract(eff.awsRegion, creds);
      await client.send(
        new DetectDocumentTextCommand({
          Document: { Bytes: this.testImage() },
        }),
        { abortSignal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
      );
      return done(true, 'Amazon Textract respondió bien.');
    } catch (e) {
      const name = String((e as { name?: string })?.name ?? '');
      if (DOC_ERRORS.test(name)) {
        return done(true, 'Amazon Textract respondió: las claves funcionan.');
      }
      return done(false, mapTestError(e));
    }
  }

  private async probeLocal(
    done: (ok: boolean, m: string) => OcrProbeResult,
  ): Promise<OcrProbeResult> {
    const desktop = isDesktop(this.config);
    let url: string | null;
    if (desktop) {
      url = this.runner.getUrl();
      if (!url) {
        return done(
          false,
          this.runner.getStatus().estado === 'iniciando'
            ? 'El OCR de tu computador se está iniciando. Prueba de nuevo en un momento.'
            : 'El OCR de tu computador no está en marcha. Prepáralo primero.',
        );
      }
    } else {
      url = readOcrConfig(this.config).localUrl;
    }
    try {
      const h = await this.checkHealth(url);
      if (h.ok === false)
        return done(false, 'El servicio de OCR no está sano.');
      return done(
        true,
        h.fallback_reason
          ? 'El OCR responde, pero usa Tesseract como respaldo (menos preciso con manuscrito).'
          : desktop
            ? 'El OCR de tu computador responde bien.'
            : 'El servicio de OCR responde bien.',
      );
    } catch {
      return done(
        false,
        desktop
          ? 'No se pudo conectar con el OCR de tu computador.'
          : 'No se pudo conectar con el servicio de OCR. Revisa que el contenedor ocr-local esté en marcha.',
      );
    }
  }
}
