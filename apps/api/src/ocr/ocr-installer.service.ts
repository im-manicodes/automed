import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  rename,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Prisma } from '../generated/prisma/client';
import { LogBufferService, type LogEntry } from '../logs/log-buffer.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  MANAGED_HOST,
  MANAGED_PORT,
  MIN_FREE_BYTES,
  OPENCV_HEADLESS,
  OPENCV_VARIANTS,
  PYTHON_DOWNLOADS,
  PYTHON_VERSION,
  isOcrManaged,
  ocrLocalPaths,
  pythonEnv,
  type OcrLocalPaths,
} from './ocr-local-paths';
import { OcrSupervisorService } from './ocr-supervisor.service';

export const OCR_INSTALL_KEY = 'ocr.local.install';
/** Contexto del registro para la salida de la instalación. */
export const OCR_INSTALL_LOG = 'ocr-install';

export type OcrInstallEstado =
  'no-instalado' | 'instalando' | 'descargando-modelos' | 'listo' | 'error';

/** Lo que se guarda en Setting `ocr.local.install`. */
export interface OcrInstallState {
  estado: OcrInstallEstado;
  /** Paso actual en español sencillo. */
  paso: string;
  /** Avance aproximado 0..100. */
  progreso: number;
  /** sha256 del requirements.txt instalado (para saber si hay que reinstalar). */
  requirementsSha: string | null;
  pythonVersion: string | null;
  error: string | null;
  actualizado: string;
}

export interface OcrLocalView extends OcrInstallState {
  /** false: OCR_LOCAL_URL apunta a un servicio externo y la API no gestiona nada. */
  gestionado: boolean;
  /** Hay una versión nueva del OCR empaquetada (o de Python): conviene reinstalar. */
  desactualizado: boolean;
  proceso: 'detenido' | 'iniciando' | 'en-marcha' | 'error';
  lineas: Pick<LogEntry, 'id' | 'ts' | 'nivel' | 'mensaje'>[];
  requisitos: { espacioGb: number; internet: true };
}

const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
/** Lo que puede tardar la primera respuesta de /health (descarga de modelos). */
const WARMUP_TIMEOUT_MS = 20 * 60_000;
const WARMUP_POLL_MS = 3000;
const TAIL_LINES = 20;

const INITIAL: Omit<OcrInstallState, 'actualizado'> = {
  estado: 'no-instalado',
  paso: 'Sin instalar',
  progreso: 0,
  requirementsSha: null,
  pythonVersion: null,
  error: null,
};

/** Error con mensaje para la UI (español, sin datos sensibles). */
class InstallError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const sha256 = (data: Buffer | string) =>
  createHash('sha256').update(data).digest('hex');

/**
 * Instala el OCR local (PaddleOCR) en OCR_HOME (/models) sin Python en la imagen:
 * Python autónomo con sha256 fijado -> código empaquetado en la API -> venv temporal ->
 * pip install -r requirements -> OpenCV headless -> comprobación -> renombrado atómico a venv ->
 * calentamiento (primer /health descarga los modelos). Una sola instalación a la vez.
 * Todos los comandos y argumentos son FIJOS; ninguno viene de la petición.
 */
@Injectable()
export class OcrInstallerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OcrInstallerService.name);
  private running: Promise<void> | null = null;
  private cache: OcrInstallState | null = null;
  private assetSha: string | null | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly supervisor: OcrSupervisorService,
    @Optional() private readonly buffer?: LogBufferService,
  ) {}

  get managed(): boolean {
    return isOcrManaged(this.config);
  }

  get paths(): OcrLocalPaths {
    return ocrLocalPaths(this.config);
  }

  get busy(): boolean {
    return this.running !== null;
  }

  private log(msg: string, nivel: 'log' | 'warn' | 'error' = 'log') {
    this.buffer?.forContext(OCR_INSTALL_LOG)[nivel](msg);
  }

  /** Al arrancar: corrige instalaciones interrumpidas y auto-arranca si está listo. */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.managed) return;
    try {
      const s = await this.getState();
      if (s.estado === 'instalando' || s.estado === 'descargando-modelos') {
        await this.setState({
          estado: 'error',
          error:
            'La instalación se interrumpió (la app se reinició). Vuelve a intentarlo.',
          paso: 'Interrumpida',
        });
        return;
      }
      if (s.estado === 'listo' && !this.supervisor.isInstalled()) {
        await this.setState({ ...INITIAL });
        return;
      }
      if (s.estado === 'listo') {
        this.supervisor.start();
        this.logger.log('OCR local instalado: arrancando.');
      }
    } catch (e) {
      this.logger.warn(
        `No se pudo revisar el OCR local al arrancar: ${(e as Error).message}`,
      );
    }
  }

  async getState(): Promise<OcrInstallState> {
    if (this.cache) return this.cache;
    const row = await this.prisma.setting.findUnique({
      where: { key: OCR_INSTALL_KEY },
    });
    const v = isObj(row?.value) ? (row.value as Partial<OcrInstallState>) : {};
    this.cache = {
      ...INITIAL,
      actualizado: new Date(0).toISOString(),
      ...v,
    };
    return this.cache;
  }

  protected async setState(
    patch: Partial<OcrInstallState>,
  ): Promise<OcrInstallState> {
    const prev = await this.getState();
    const next: OcrInstallState = {
      ...prev,
      ...patch,
      progreso: Math.max(
        0,
        Math.min(100, Math.round(patch.progreso ?? prev.progreso)),
      ),
      actualizado: new Date().toISOString(),
    };
    this.cache = next;
    const value = JSON.parse(JSON.stringify(next)) as Prisma.InputJsonObject;
    await this.prisma.setting.upsert({
      where: { key: OCR_INSTALL_KEY },
      update: { value },
      create: { key: OCR_INSTALL_KEY, value },
    });
    return next;
  }

  /** sha256 del requirements.txt del paquete incluido en la API (null si no hay paquete). */
  protected async packagedRequirementsSha(): Promise<string | null> {
    if (this.assetSha !== undefined) return this.assetSha;
    const asset = this.paths.asset;
    if (!existsSync(asset)) return (this.assetSha = null);
    try {
      const out = await this.capture('tar', [
        '-xzOf',
        asset,
        'requirements.txt',
      ]);
      this.assetSha = sha256(out);
    } catch {
      this.assetSha = null;
    }
    return this.assetSha;
  }

  async view(): Promise<OcrLocalView> {
    const s = await this.getState();
    const sha =
      s.estado === 'listo' ? await this.packagedRequirementsSha() : null;
    return {
      ...s,
      gestionado: this.managed,
      desactualizado:
        s.estado === 'listo' &&
        ((sha !== null && s.requirementsSha !== sha) ||
          s.pythonVersion !== PYTHON_VERSION),
      proceso: this.supervisor.status().proceso,
      lineas: (this.buffer?.tail(OCR_INSTALL_LOG, TAIL_LINES) ?? []).map(
        ({ id, ts, nivel, mensaje }) => ({ id, ts, nivel, mensaje }),
      ),
      requisitos: {
        espacioGb: Math.round(MIN_FREE_BYTES / 1024 ** 3),
        internet: true,
      },
    };
  }

  private assertManaged() {
    if (!this.managed) {
      throw new ConflictException(
        'El OCR lo da un servicio externo (OCR_LOCAL_URL); no se gestiona desde aquí.',
      );
    }
  }

  /** Lanza la instalación en segundo plano (409 si ya hay una). Devuelve el estado inicial. */
  async install(): Promise<OcrInstallState> {
    this.assertManaged();
    if (this.running) {
      throw new ConflictException('Ya hay una instalación en marcha.');
    }
    // Reservar el bloqueo ANTES de cualquier await: dos clics seguidos no lanzan dos instalaciones.
    let release!: () => void;
    this.running = new Promise<void>((r) => (release = r));
    try {
      const first = await this.setState({
        estado: 'instalando',
        paso: 'Preparando',
        progreso: 1,
        error: null,
      });
      void this.runInstall()
        .catch(() => undefined)
        .finally(() => {
          this.running = null;
          release();
        });
      return first;
    } catch (e) {
      this.running = null;
      release();
      throw e;
    }
  }

  /** Espera a que termine la instalación en curso (pruebas). */
  async waitIdle(): Promise<void> {
    while (this.running) await this.running;
  }

  startService(): void {
    this.assertManaged();
    if (this.running)
      throw new ConflictException('Espera a que termine la instalación.');
    if (!this.supervisor.isInstalled()) {
      throw new ConflictException('Primero instala el OCR local.');
    }
    this.supervisor.start();
  }

  async stopService(): Promise<void> {
    this.assertManaged();
    if (this.running)
      throw new ConflictException('Espera a que termine la instalación.');
    await this.supervisor.stop();
  }

  /** Desinstala: detiene y borra Python, venv y código. Los modelos se conservan. */
  async uninstall(): Promise<OcrInstallState> {
    this.assertManaged();
    if (this.running)
      throw new ConflictException('Espera a que termine la instalación.');
    await this.supervisor.stop();
    const p = this.paths;
    for (const dir of [
      p.venv,
      p.venvTmp,
      p.venvOld,
      p.code,
      `${p.code}.tmp`,
      p.python,
    ]) {
      await rm(dir, { recursive: true, force: true });
    }
    this.log('OCR local desinstalado (los modelos descargados se conservan).');
    return this.setState({ ...INITIAL });
  }

  // ---------------------------------------------------------------------------------------

  private async step(
    paso: string,
    progreso: number,
    estado: OcrInstallEstado = 'instalando',
  ) {
    this.log(`== ${paso}`);
    await this.setState({ estado, paso, progreso });
  }

  private async runInstall(): Promise<void> {
    const p = this.paths;
    try {
      await this.step('Revisando espacio libre', 2);
      await mkdir(p.home, { recursive: true });
      await this.checkFreeSpace(p.home);
      await this.supervisor.stop();

      await this.ensurePython(p);

      await this.step('Copiando el programa de OCR', 16);
      await this.extractCode(p);
      const reqSha = sha256(await readFile(p.requirements));

      await this.step('Creando el entorno de Python', 20);
      await rm(p.venvTmp, { recursive: true, force: true });
      await this.run(p.pythonBin, ['-m', 'venv', p.venvTmp], p);
      const tmpPy = join(p.venvTmp, 'bin', 'python');
      await this.run(tmpPy, ['-m', 'pip', 'install', '--upgrade', 'pip'], p);

      await this.step('Instalando dependencias (puede tardar bastante)', 25);
      let seen = 0;
      let lastPct = 25;
      await this.run(
        tmpPy,
        ['-m', 'pip', 'install', '-r', p.requirements],
        p,
        (line) => {
          if (/^(Collecting|Downloading|Installing)/.test(line)) {
            seen++;
            // Avance aproximado: 25% -> 68% según los paquetes vistos (~120 en total).
            const pct = 25 + Math.min(43, Math.round((seen / 120) * 43));
            if (pct > lastPct) {
              lastPct = pct;
              void this.setState({ progreso: pct }).catch(() => undefined);
            }
          }
        },
      );

      await this.step('Ajustando OpenCV (versión sin pantalla)', 70);
      await this.run(
        tmpPy,
        ['-m', 'pip', 'uninstall', '-y', ...OPENCV_VARIANTS],
        p,
      );
      await this.run(tmpPy, ['-m', 'pip', 'install', OPENCV_HEADLESS], p);

      await this.step('Comprobando las librerías', 76);
      await this.checkImports(tmpPy, p);

      await this.step('Activando la nueva versión', 80);
      await rm(p.venvOld, { recursive: true, force: true });
      if (existsSync(p.venv)) await rename(p.venv, p.venvOld);
      await rename(p.venvTmp, p.venv);
      await rm(p.venvOld, { recursive: true, force: true });

      await this.step(
        'Descargando los modelos de lectura (la primera vez tarda)',
        85,
        'descargando-modelos',
      );
      this.supervisor.start();
      await this.warmup();

      await this.setState({
        estado: 'listo',
        paso: 'Listo',
        progreso: 100,
        requirementsSha: reqSha,
        pythonVersion: PYTHON_VERSION,
        error: null,
      });
      this.log('OCR local instalado y funcionando.');
    } catch (e) {
      const msg =
        e instanceof InstallError
          ? e.message
          : 'La instalación falló. Revisa las últimas líneas y vuelve a intentarlo.';
      if (!(e instanceof InstallError)) {
        this.log(`Error: ${(e as Error)?.message ?? String(e)}`, 'error');
      } else {
        this.log(msg, 'error');
      }
      await this.supervisor.stop().catch(() => undefined);
      await rm(p.venvTmp, { recursive: true, force: true }).catch(
        () => undefined,
      );
      await this.setState({ estado: 'error', error: msg, paso: 'Falló' }).catch(
        () => undefined,
      );
      throw e;
    }
  }

  /** Descarga fijada para esta arquitectura (url + sha256). */
  protected pythonDownload(): { url: string; sha256: string } | undefined {
    return PYTHON_DOWNLOADS[process.arch];
  }

  protected async freeBytes(dir: string): Promise<number> {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  }

  private async checkFreeSpace(dir: string) {
    let free: number;
    try {
      free = await this.freeBytes(dir);
    } catch {
      throw new InstallError(
        `No se puede escribir en ${dir}. Revisa que el volumen de modelos esté montado.`,
      );
    }
    // Si ya hay venv, una reinstalación reutiliza parte del espacio: se exige la mitad.
    const need = existsSync(this.paths.venv)
      ? MIN_FREE_BYTES / 2
      : MIN_FREE_BYTES;
    if (free < need) {
      const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
      throw new InstallError(
        `No hay espacio suficiente: hay ${gb(free)} GB libres y se necesitan unos ${gb(need)} GB.`,
      );
    }
  }

  private async ensurePython(p: OcrLocalPaths) {
    const marker = existsSync(p.pythonMarker)
      ? (await readFile(p.pythonMarker, 'utf8')).trim()
      : null;
    if (existsSync(p.pythonBin) && marker === PYTHON_VERSION) {
      this.log(`Python ${PYTHON_VERSION} ya está instalado.`);
      return;
    }
    const dl = this.pythonDownload();
    if (!dl) {
      throw new InstallError(
        `Este equipo (${process.arch}) no es compatible con el OCR local.`,
      );
    }
    await this.step(`Descargando Python ${PYTHON_VERSION}`, 5);
    const archive = join(p.home, 'python.tar.gz.tmp');
    const tmpDir = join(p.home, 'python.tmp');
    try {
      await this.download(dl.url, archive);
      const got = sha256(await readFile(archive));
      if (got !== dl.sha256) {
        throw new InstallError(
          'La descarga de Python no es la esperada (la huella no coincide). Vuelve a intentarlo.',
        );
      }
      await this.step('Preparando Python', 12);
      await rm(tmpDir, { recursive: true, force: true });
      await mkdir(tmpDir, { recursive: true });
      await this.run('tar', ['-xzf', archive, '-C', tmpDir], p);
      await rm(p.python, { recursive: true, force: true });
      await rename(join(tmpDir, 'python'), p.python);
      await writeFile(p.pythonMarker, PYTHON_VERSION);
      // Cambió Python: el venv anterior ya no sirve.
      await rm(p.venv, { recursive: true, force: true });
    } finally {
      await rm(archive, { force: true }).catch(() => undefined);
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async extractCode(p: OcrLocalPaths) {
    if (!existsSync(p.asset)) {
      throw new InstallError(
        'Falta el paquete del OCR en esta versión de la app (ocr-local.tgz). Avisa a quien la instaló.',
      );
    }
    const tmp = `${p.code}.tmp`;
    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp, { recursive: true });
    await this.run('tar', ['-xzf', p.asset, '-C', tmp], p);
    if (!existsSync(join(tmp, 'requirements.txt'))) {
      throw new InstallError('El paquete del OCR está incompleto.');
    }
    await rm(p.code, { recursive: true, force: true });
    await rename(tmp, p.code);
  }

  private async checkImports(py: string, p: OcrLocalPaths) {
    let stderr = '';
    try {
      await this.run(py, ['-c', 'import cv2, paddle, paddleocr'], p, (l) => {
        stderr += `${l}\n`;
      });
    } catch {
      const lib = /(lib[\w.+-]+\.so[\w.]*)/.exec(stderr)?.[1];
      throw new InstallError(
        lib
          ? `Falta una librería del sistema (${lib}). Hay que añadirla a la imagen de la app (p. ej. libgomp1 o libglib2.0-0).`
          : 'Las librerías del OCR no cargan. Revisa las últimas líneas.',
      );
    }
  }

  /** Arranca y espera el primer /health correcto (descarga los modelos). */
  protected async warmup(): Promise<void> {
    const deadline = Date.now() + this.warmupTimeoutMs();
    const url = `http://${MANAGED_HOST}:${MANAGED_PORT}/health`;
    while (Date.now() < deadline) {
      const st = this.supervisor.status();
      if (st.proceso === 'error') {
        throw new InstallError(
          'El OCR no logró arrancar. Revisa las últimas líneas.',
        );
      }
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
        });
        if (res.ok) {
          this.supervisor.markHealthy();
          return;
        }
      } catch {
        /* aún no escucha */
      }
      await new Promise((r) => setTimeout(r, this.warmupPollMs()));
    }
    throw new InstallError(
      'El OCR tardó demasiado en responder. Revisa la conexión a internet y vuelve a intentarlo.',
    );
  }

  protected warmupTimeoutMs() {
    return WARMUP_TIMEOUT_MS;
  }

  protected warmupPollMs() {
    return WARMUP_POLL_MS;
  }

  /** Descarga a archivo (sin seguir nada que venga del usuario: URL fija). */
  protected async download(url: string, dest: string): Promise<void> {
    this.log('Descargando Python autónomo (python-build-standalone)…');
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch {
      throw new InstallError(
        'No se pudo descargar Python. Revisa que el servidor tenga internet.',
      );
    }
    if (!res.ok || !res.body) {
      throw new InstallError(
        `No se pudo descargar Python (HTTP ${res.status}).`,
      );
    }
    await pipeline(
      Readable.fromWeb(res.body as unknown as WebReadableStream),
      createWriteStream(dest),
    );
  }

  /** spawn con comando y args FIJOS; la salida va al registro `ocr-install`. */
  protected run(
    cmd: string,
    args: string[],
    p: OcrLocalPaths,
    onLine?: (line: string) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: p.home,
        env: pythonEnv(p),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const pipe = (s: NodeJS.ReadableStream | null) => {
        let rest = '';
        s?.on('data', (chunk: Buffer) => {
          const lines = (rest + chunk.toString('utf8')).split(/\r?\n/);
          rest = lines.pop() ?? '';
          for (const l of lines) {
            if (!l.trim()) continue;
            this.log(l);
            onLine?.(l);
          }
        });
        s?.on('end', () => {
          if (rest.trim()) {
            this.log(rest);
            onLine?.(rest);
          }
        });
      };
      pipe(child.stdout);
      pipe(child.stderr);
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(`${cmd.split('/').pop()} terminó con código ${code}`),
          );
      });
    });
  }

  /** spawn con args FIJOS que devuelve stdout (sin registrarlo). */
  protected capture(cmd: string, args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks: Buffer[] = [];
      child.stdout?.on('data', (c: Buffer) => chunks.push(c));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0
          ? resolve(Buffer.concat(chunks))
          : reject(new Error(`código ${code}`)),
      );
    });
  }
}
