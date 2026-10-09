import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { LogBufferService } from '../logs/log-buffer.service';
import {
  MANAGED_HOST,
  MANAGED_PORT,
  isOcrManaged,
  ocrLocalPaths,
  pythonEnv,
  type OcrLocalPaths,
} from './ocr-local-paths';

export type OcrProcessState = 'detenido' | 'iniciando' | 'en-marcha' | 'error';

export interface OcrSupervisorStatus {
  proceso: OcrProcessState;
  reinicios: number;
  ultimoError: string | null;
}

/** Contexto del registro (Ajustes -> Registro) para la salida de uvicorn. */
export const OCR_PROCESS_LOG = 'ocr-local';

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 60_000;
/** Tras este tiempo en marcha se olvidan los fallos anteriores. */
const STABLE_MS = 60_000;
/** Fallos seguidos antes de rendirse (queda en `error` hasta Iniciar). */
const MAX_FAILURES = 8;
const KILL_GRACE_MS = 5000;

/**
 * Supervisa el proceso uvicorn del OCR local en 127.0.0.1:8000 (modo gestionado).
 * Reinicia con backoff exponencial y lo mata al cerrar la API. Si OCR_LOCAL_URL apunta a
 * un servicio externo no hace nada. Comando y argumentos FIJOS (sin entrada del usuario).
 */
@Injectable()
export class OcrSupervisorService implements OnModuleDestroy {
  private readonly logger = new Logger(OcrSupervisorService.name);
  private child: ChildProcess | null = null;
  private wanted = false;
  private state: OcrProcessState = 'detenido';
  private failures = 0;
  private restarts = 0;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private startedAt = 0;
  private readonly onExit = () => this.child?.kill('SIGKILL');

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly buffer?: LogBufferService,
  ) {}

  get managed(): boolean {
    return isOcrManaged(this.config);
  }

  get paths(): OcrLocalPaths {
    return ocrLocalPaths(this.config);
  }

  /** ¿Hay un OCR instalado que se pueda arrancar? */
  isInstalled(): boolean {
    const p = this.paths;
    return existsSync(p.venvPython) && existsSync(`${p.code}/app/main.py`);
  }

  status(): OcrSupervisorStatus {
    return {
      proceso: this.state,
      reinicios: this.restarts,
      ultimoError: this.lastError,
    };
  }

  /** Marca el proceso como sano (lo llama quien comprueba /health). */
  markHealthy(): void {
    if (this.child && this.state === 'iniciando') this.state = 'en-marcha';
  }

  /** Arranca (idempotente). Lanza si no está instalado o no es modo gestionado. */
  start(): void {
    if (!this.managed) {
      throw new Error('El OCR lo gestiona un servicio externo.');
    }
    if (!this.isInstalled()) throw new Error('El OCR local no está instalado.');
    this.wanted = true;
    this.failures = 0;
    this.lastError = null;
    if (this.child) return;
    this.clearTimer();
    this.spawnChild();
  }

  /** Detiene el proceso y no lo vuelve a arrancar. */
  async stop(): Promise<void> {
    this.wanted = false;
    this.clearTimer();
    const child = this.child;
    if (!child) {
      if (this.state !== 'error') this.state = 'detenido';
      return;
    }
    await new Promise<void>((done) => {
      const kill = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      child.once('exit', () => {
        clearTimeout(kill);
        done();
      });
      child.kill('SIGTERM');
    });
    this.state = 'detenido';
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  protected spawnProcess(
    cmd: string,
    args: string[],
    opts: { cwd: string; env: NodeJS.ProcessEnv },
  ): ChildProcess {
    return spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  }

  private spawnChild() {
    const p = this.paths;
    const log = this.buffer?.forContext(OCR_PROCESS_LOG);
    this.state = 'iniciando';
    this.startedAt = Date.now();
    let child: ChildProcess;
    try {
      child = this.spawnProcess(
        p.venvPython,
        [
          '-m',
          'uvicorn',
          'app.main:app',
          '--host',
          MANAGED_HOST,
          '--port',
          String(MANAGED_PORT),
          '--no-access-log',
        ],
        { cwd: p.code, env: pythonEnv(p) },
      );
    } catch (e) {
      this.handleExit(e instanceof Error ? e.message : 'no se pudo iniciar');
      return;
    }
    this.child = child;
    process.once('exit', this.onExit);
    const pipe = (s: NodeJS.ReadableStream | null) => {
      let rest = '';
      s?.on('data', (chunk: Buffer) => {
        const lines = (rest + chunk.toString('utf8')).split(/\r?\n/);
        rest = lines.pop() ?? '';
        for (const l of lines) if (l.trim()) log?.log(l);
      });
    };
    pipe(child.stdout);
    pipe(child.stderr);
    child.on('error', (e) => {
      log?.error(`No se pudo iniciar el OCR: ${e.message}`);
    });
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      process.removeListener('exit', this.onExit);
      this.handleExit(
        `terminó (código ${code ?? '-'}, señal ${signal ?? '-'})`,
      );
    });
  }

  private handleExit(reason: string) {
    if (!this.wanted) {
      this.state = 'detenido';
      return;
    }
    if (Date.now() - this.startedAt > STABLE_MS) this.failures = 0;
    this.failures++;
    this.lastError = `El OCR local ${reason}.`;
    this.buffer?.forContext(OCR_PROCESS_LOG).warn(this.lastError);
    if (this.failures >= MAX_FAILURES) {
      this.wanted = false;
      this.state = 'error';
      this.logger.error(
        'El OCR local falló varias veces seguidas; se deja detenido.',
      );
      return;
    }
    const delay = Math.min(
      BACKOFF_BASE_MS * 2 ** (this.failures - 1),
      BACKOFF_MAX_MS,
    );
    this.state = 'iniciando';
    this.restarts++;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.wanted && !this.child) this.spawnChild();
    }, delay);
    this.timer.unref?.();
  }
}
