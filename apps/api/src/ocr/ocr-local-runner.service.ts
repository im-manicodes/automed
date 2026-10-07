import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import { OcrSettingsService } from '../settings/ocr-settings.service';
import { isDesktop } from './app-mode';
import { PythonEnvService } from './python-env.service';
import { PROCESS_RUNNER, defaultProcessRunner } from './process-runner';
import type { ProcessRunner, SpawnedProcess } from './process-runner';

export type LocalServiceState = 'detenido' | 'iniciando' | 'listo' | 'error';

export interface LocalServiceStatus {
  estado: LocalServiceState;
  fallbackReason?: string | null;
  mensaje?: string;
}

export const RUNNER_TIMING = Symbol('RUNNER_TIMING');
export interface RunnerTiming {
  pollMs: number;
  startTimeoutMs: number;
  /** Esperas antes de cada reinicio automático; al agotarse queda en error. */
  backoffMs: number[];
}
const DEFAULT_TIMING: RunnerTiming = {
  pollMs: 500,
  startTimeoutMs: 180_000,
  backoffMs: [1000, 2000, 5000, 10_000, 30_000],
};

/** Variables que el proceso hijo necesita; no se le pasan secretos de la API. */
const ENV_ALLOW = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'SYSTEMROOT',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'APPDATA',
  'LOCALAPPDATA',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
];

/**
 * Solo en APP_MODE=desktop: lanza el servicio `services/ocr-local` (uvicorn) con el venv
 * preparado cuando el motor elegido es `local`; lo reinicia si cae y lo detiene al cerrar.
 */
@Injectable()
export class OcrLocalRunner implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OcrLocalRunner.name);
  private readonly timing: RunnerTiming;
  private status: LocalServiceStatus = { estado: 'detenido' };
  private url: string | null = null;
  private child: SpawnedProcess | null = null;
  private generation = 0;
  private failures = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private unsubscribe?: () => void;

  constructor(
    private readonly config: ConfigService,
    private readonly settings: OcrSettingsService,
    private readonly env: PythonEnvService,
    @Optional()
    @Inject(PROCESS_RUNNER)
    private readonly proc: ProcessRunner = defaultProcessRunner,
    @Optional() @Inject(RUNNER_TIMING) timing?: RunnerTiming,
  ) {
    this.timing = timing ?? DEFAULT_TIMING;
  }

  onModuleInit() {
    if (!isDesktop(this.config)) return;
    this.unsubscribe = this.env.onChange(() => void this.reconcile());
    void this.reconcile();
  }

  onApplicationShutdown() {
    this.unsubscribe?.();
    this.stop();
  }

  getStatus(): LocalServiceStatus {
    return { ...this.status };
  }

  /** URL del servicio solo cuando ya responde. */
  getUrl(): string | null {
    return this.status.estado === 'listo' ? this.url : null;
  }

  /** Arranca o detiene el servicio según el motor elegido y el estado del entorno. */
  async reconcile(): Promise<void> {
    if (!isDesktop(this.config)) return;
    const { motor } = await this.settings.getEffective();
    const want = motor === 'local' && this.env.isReady();
    const running = this.child !== null || this.restartTimer !== null;
    if (want && !running) {
      this.failures = 0;
      await this.start();
    } else if (!want && (running || this.status.estado !== 'detenido')) {
      this.stop();
    }
  }

  private childEnv(): NodeJS.ProcessEnv {
    const out: NodeJS.ProcessEnv = {};
    for (const k of ENV_ALLOW) if (process.env[k]) out[k] = process.env[k];
    out.PADDLE_PDX_CACHE_HOME = this.env.modelsDir;
    out.OCR_LOCAL_ENGINE =
      this.config.get<string>('OCR_LOCAL_ENGINE') ?? 'paddle';
    out.OCR_LANG = this.config.get<string>('OCR_LANG') ?? 'es';
    out.PYTHONUNBUFFERED = '1';
    return out;
  }

  private async start(): Promise<void> {
    const gen = ++this.generation;
    this.status = { estado: 'iniciando' };
    let port: number;
    try {
      port = await this.proc.freePort();
    } catch {
      this.status = { estado: 'error', mensaje: 'No hay un puerto libre.' };
      return;
    }
    if (gen !== this.generation) return;
    const url = `http://127.0.0.1:${port}`;
    const appDir =
      this.config.get<string>('OCR_LOCAL_APP_DIR') ??
      resolve(process.cwd(), '../../services/ocr-local');
    let child: SpawnedProcess;
    try {
      child = this.proc.spawn(
        this.env.venvPython,
        [
          '-m',
          'uvicorn',
          'app.main:app',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
        ],
        { cwd: appDir, env: this.childEnv() },
      );
    } catch {
      this.onCrash(gen, 'No se pudo iniciar el servicio de OCR.');
      return;
    }
    this.child = child;
    this.url = url;
    // Se consume la salida para que el pipe no se llene; no se registra su contenido.
    child.stdout?.on('data', () => undefined);
    child.stderr?.on('data', () => undefined);
    child.on('error', () => {
      if (this.child === child)
        this.onCrash(gen, 'No se pudo iniciar el servicio de OCR.');
    });
    child.on('exit', () => {
      if (this.child === child)
        this.onCrash(gen, 'El servicio de OCR se detuvo.');
    });

    const deadline = Date.now() + this.timing.startTimeoutMs;
    while (gen === this.generation && Date.now() < deadline) {
      const h = await this.proc.health(url);
      if (gen !== this.generation) return;
      if (h.ok) {
        this.failures = 0;
        this.status = {
          estado: 'listo',
          fallbackReason: h.fallbackReason ?? null,
        };
        this.logger.log('Servicio de OCR local listo');
        return;
      }
      if (this.child !== child) return; // cayó durante la espera
      await new Promise((r) => setTimeout(r, this.timing.pollMs));
    }
    if (gen === this.generation && this.status.estado === 'iniciando') {
      this.killChild();
      this.onCrash(gen, 'El servicio de OCR no respondió a tiempo.');
    }
  }

  private killChild() {
    const c = this.child;
    this.child = null;
    try {
      c?.kill();
    } catch {
      /* ya terminó */
    }
  }

  private onCrash(gen: number, mensaje: string) {
    if (gen !== this.generation) return; // parada voluntaria o instancia vieja
    this.child = null;
    const wait = this.timing.backoffMs[this.failures];
    this.failures += 1;
    if (wait === undefined) {
      this.status = { estado: 'error', mensaje };
      this.logger.warn('El servicio de OCR local no pudo reiniciarse');
      return;
    }
    this.status = { estado: 'iniciando', mensaje };
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start();
    }, wait);
  }

  stop() {
    this.generation += 1; // invalida esperas y salidas pendientes
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.killChild();
    this.url = null;
    this.status = { estado: 'detenido' };
  }
}
