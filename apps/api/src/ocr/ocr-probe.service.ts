import {
  DetectDocumentTextCommand,
  TextractClient,
} from '@aws-sdk/client-textract';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCanvas } from '@napi-rs/canvas';
import { AiSettingsService } from '../settings/ai-settings.service';
import { mapTestError } from '../settings/ai-test.service';
import { OcrSettingsService } from '../settings/ocr-settings.service';
import { readOcrConfig } from './ocr-config';
import { AzureOcrEngineService } from './azure-ocr-engine.service';
import { OcrInstallerService } from './ocr-installer.service';
import { OcrSupervisorService } from './ocr-supervisor.service';

export type LocalServiceStatus =
  | { estado: 'listo'; fallbackReason: string | null }
  | { estado: 'detenido' | 'iniciando' | 'error'; mensaje: string };

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
const MANAGED_NOT_INSTALLED_MSG =
  'El OCR local no está instalado. Pulsa «Instalar OCR local».';
const MANAGED_INSTALLING_MSG =
  'Se está instalando el OCR local. Puedes seguir usando la app mientras tanto.';
const MANAGED_STARTING_MSG = 'El OCR local se está iniciando.';
const MANAGED_STOPPED_MSG = 'El OCR local está detenido. Pulsa «Iniciar».';
const MANAGED_CRASHED_MSG =
  'El OCR local se detuvo por un fallo. Revisa el registro y pulsa «Iniciar» o «Reinstalar».';
/** Textract acepta como respuesta "válida" estos errores: la autenticación ya pasó. */
const DOC_ERRORS = /BadDocument|UnsupportedDocument|InvalidParameter/i;

/** Prueba mínima del OCR elegido. Nunca incluye claves ni contenido en el mensaje. */
@Injectable()
export class OcrProbeService {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: OcrSettingsService,
    private readonly ai: AiSettingsService,
    @Optional() private readonly installer?: OcrInstallerService,
    @Optional() private readonly supervisor?: OcrSupervisorService,
    @Optional() private readonly azure?: AzureOcrEngineService,
  ) {}

  /** ¿La API instala y arranca el OCR local (no hay un servicio externo en OCR_LOCAL_URL)? */
  private get managed(): boolean {
    return !!this.installer?.managed;
  }

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
   * Estado del servicio OCR local en la versión web. Con servicio externo (OCR_LOCAL_URL, p. ej. el
   * contenedor ocr-local de desarrollo) solo hace el health check; en modo gestionado lo combina con
   * el estado del instalador y del proceso (iniciando/error). Nunca lanza.
   */
  async serverLocalStatus(): Promise<LocalServiceStatus> {
    if (this.managed && this.installer) {
      try {
        const st = await this.installer.getState();
        if (st.estado === 'instalando' || st.estado === 'descargando-modelos') {
          return { estado: 'iniciando', mensaje: MANAGED_INSTALLING_MSG };
        }
        if (st.estado === 'error') {
          return {
            estado: 'error',
            mensaje: st.error ?? 'La instalación del OCR local falló.',
          };
        }
        if (st.estado === 'no-instalado') {
          return { estado: 'detenido', mensaje: MANAGED_NOT_INSTALLED_MSG };
        }
      } catch {
        /* sin BD: se decide solo con el health check */
      }
    }
    try {
      const h = await this.checkHealth(
        readOcrConfig(this.config).localUrl,
        STATUS_TIMEOUT_MS,
      );
      if (h.ok === false) throw new Error('unhealthy');
      this.supervisor?.markHealthy();
      return { estado: 'listo', fallbackReason: h.fallback_reason ?? null };
    } catch {
      if (!this.managed)
        return { estado: 'detenido', mensaje: SERVER_DOWN_MSG };
      const proceso = this.supervisor?.status().proceso ?? 'detenido';
      if (proceso === 'iniciando' || proceso === 'en-marcha') {
        return { estado: 'iniciando', mensaje: MANAGED_STARTING_MSG };
      }
      if (proceso === 'error') {
        return { estado: 'error', mensaje: MANAGED_CRASHED_MSG };
      }
      return { estado: 'detenido', mensaje: MANAGED_STOPPED_MSG };
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
    if (motor === 'azure') return this.probeAzure(done);
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

  private async probeAzure(
    done: (ok: boolean, m: string) => OcrProbeResult,
  ): Promise<OcrProbeResult> {
    try {
      if (!this.azure) throw new Error('azure');
      await this.azure.recognize(this.testImage(), 1);
      return done(true, 'Azure Document Intelligence respondió bien.');
    } catch (e) {
      const m = String((e as { message?: string })?.message ?? '');
      if (/^Falta la dirección/.test(m)) return done(false, m);
      return done(false, mapTestError(e));
    }
  }

  private async probeLocal(
    done: (ok: boolean, m: string) => OcrProbeResult,
  ): Promise<OcrProbeResult> {
    const url = readOcrConfig(this.config).localUrl;
    try {
      const h = await this.checkHealth(url);
      if (h.ok === false)
        return done(false, 'El servicio de OCR no está sano.');
      return done(
        true,
        h.fallback_reason
          ? 'El OCR responde, pero usa Tesseract como respaldo (menos preciso con manuscrito).'
          : 'El servicio de OCR responde bien.',
      );
    } catch {
      return done(
        false,
        this.managed
          ? 'No se pudo conectar con el OCR local. Revisa en Ajustes que esté instalado e iniciado.'
          : 'No se pudo conectar con el servicio de OCR. Revisa que el contenedor ocr-local esté en marcha.',
      );
    }
  }
}
