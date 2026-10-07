import {
  ConflictException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { pythonDir } from './app-mode';
import { PROCESS_RUNNER, defaultProcessRunner } from './process-runner';
import type { ProcessRunner } from './process-runner';

/**
 * Versión de Python de referencia (la del services/ocr-local/Dockerfile) y rango soportado.
 *
 * Verificado en PyPI (2026-10): paquetes fijados en services/ocr-local/requirements.txt
 *  - paddlepaddle==3.0.0: ruedas cp38..cp313 (Linux x86_64 y Windows amd64);
 *  - paddlex==3.0.3: clasificadores de Python 3.8 a 3.12 (sin cp313 declarado);
 *  - numpy>=1.26 y uvicorn 0.34 exigen Python >= 3.9.
 * Intersección: 3.9 a 3.12. Se recomienda 3.11 (la que se prueba en Docker).
 * Fuentes: https://pypi.org/project/paddlepaddle/3.0.0/ y https://pypi.org/project/paddlex/3.0.3/
 */
export const PYTHON_REQUIRED = '3.11';
export const PYTHON_MIN_MINOR = 9;
export const PYTHON_MAX_MINOR = 12;
export const PYTHON_RANGE = `3.${PYTHON_MIN_MINOR} a 3.${PYTHON_MAX_MINOR}`;

export type OsName = 'windows' | 'linux' | 'otro';

export interface PythonGuide {
  titulo: string;
  pasos: string[];
  comandos: string[];
  enlace?: string;
}

export interface PythonInfo {
  requerido: string;
  rango: string;
  detectado: boolean;
  version?: string;
  ejecutable?: string;
  compatible: boolean;
  motivo?: string;
  guia: PythonGuide;
}

export type EnvEstado = 'sin_preparar' | 'preparando' | 'listo' | 'error';
export type ProgresoEstado = 'inactivo' | 'preparando' | 'listo' | 'error';

export interface PythonProgress {
  estado: ProgresoEstado;
  lineas: string[];
  mensaje?: string;
}

interface Candidate {
  cmd: string;
  args: string[];
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const MAX_LINES = 50;
const MAX_LINE_LEN = 300;

export function osName(platform: string = process.platform): OsName {
  return platform === 'win32'
    ? 'windows'
    : platform === 'linux'
      ? 'linux'
      : 'otro';
}

export function buildGuide(so: OsName, motivoLinux?: 'venv'): PythonGuide {
  const v = PYTHON_REQUIRED;
  if (so === 'windows') {
    return {
      titulo: `Instala Python ${v}`,
      pasos: [
        `Descarga el instalador de Python ${v} desde python.org.`,
        'Ábrelo y marca la casilla "Add python.exe to PATH" antes de pulsar Instalar.',
        'Cuando termine, vuelve aquí y pulsa "Verificar de nuevo".',
        'Alternativa: abre una terminal y ejecuta el comando de abajo (necesita winget).',
      ],
      comandos: [`winget install Python.Python.${v}`],
      enlace: 'https://www.python.org/downloads/windows/',
    };
  }
  if (so === 'linux') {
    const pasos = [
      `Abre una terminal e instala Python ${v} con el primer comando (Debian, Ubuntu y derivadas).`,
      'El paquete "venv" es necesario: sin él no se puede crear el entorno.',
      `Si tu distribución no ofrece Python ${v}, usa el repositorio deadsnakes (Ubuntu) o instala pyenv.`,
      'Cuando termine, vuelve aquí y pulsa "Verificar de nuevo".',
    ];
    if (motivoLinux === 'venv') {
      pasos.unshift('Tu Python existe pero le falta el módulo venv.');
    }
    return {
      titulo: `Instala Python ${v}`,
      pasos,
      comandos: [
        `sudo apt install python${v} python${v}-venv`,
        `sudo add-apt-repository ppa:deadsnakes/ppa && sudo apt update && sudo apt install python${v} python${v}-venv`,
        `pyenv install ${v}`,
      ],
      enlace: 'https://www.python.org/downloads/source/',
    };
  }
  return {
    titulo: `Instala Python ${v}`,
    pasos: [
      `Instala Python ${v} desde python.org y vuelve a pulsar "Verificar de nuevo".`,
    ],
    comandos: [],
    enlace: 'https://www.python.org/downloads/',
  };
}

/** Traduce la salida de pip/venv a un mensaje comprensible (sin datos sensibles). */
export function mapPrepareError(lines: string[]): string {
  const t = lines.join('\n');
  if (
    /Temporary failure in name resolution|getaddrinfo|ConnectionError|Max retries exceeded|Network is unreachable|Connection (?:refused|reset|aborted)|timed out|ReadTimeout|SSLError|ProxyError/i.test(
      t,
    )
  ) {
    return 'No hay conexión a internet o está muy lenta. Conéctate y vuelve a intentarlo.';
  }
  if (/No space left|ENOSPC|Errno 28|not enough space|espacio/i.test(t)) {
    return 'No hay espacio suficiente en el disco. Libera espacio y vuelve a intentarlo.';
  }
  if (
    /ensurepip is not available|No module named venv|python3[.\d]*-venv|virtual environment was not created/i.test(
      t,
    )
  ) {
    return 'A Python le falta el módulo "venv". En Linux instala el paquete python3-venv (por ejemplo python3.11-venv).';
  }
  if (
    /requires a different Python|Requires-Python|not supported on this Python/i.test(
      t,
    )
  ) {
    return `Esta versión de Python no es compatible. Instala Python ${PYTHON_REQUIRED}.`;
  }
  if (/No matching distribution|Could not find a version/i.test(t)) {
    return `No se encontraron los paquetes del OCR. Revisa tu conexión a internet y que uses Python ${PYTHON_RANGE}.`;
  }
  if (/Permission denied|PermissionError|Access is denied/i.test(t)) {
    return 'No hay permiso para escribir en la carpeta de datos de la aplicación.';
  }
  return 'No se pudo preparar el OCR. Revisa los detalles de abajo y vuelve a intentarlo.';
}

@Injectable()
export class PythonEnvService {
  private estado: ProgresoEstado = 'inactivo';
  private mensaje?: string;
  private lineas: string[] = [];
  private running: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly home = homedir();

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(PROCESS_RUNNER)
    private readonly proc: ProcessRunner = defaultProcessRunner,
  ) {}

  /** Sistema operativo (ajustable en tests). */
  platform: string = process.platform;

  // ---- rutas ----

  get root() {
    return pythonDir(this.config);
  }
  get venvDir() {
    return join(this.root, 'venv');
  }
  get modelsDir() {
    return join(this.root, 'models');
  }
  get venvPython() {
    return this.platform === 'win32'
      ? join(this.venvDir, 'Scripts', 'python.exe')
      : join(this.venvDir, 'bin', 'python');
  }
  private get marker() {
    return join(this.root, '.entorno-listo');
  }
  get requirementsPath() {
    return (
      this.config.get<string>('OCR_LOCAL_REQUIREMENTS') ??
      resolve(process.cwd(), '../../services/ocr-local/requirements.txt')
    );
  }

  get so(): OsName {
    return osName(this.platform);
  }

  // ---- detección ----

  private candidates(): Candidate[] {
    const list: Candidate[] = [];
    if (this.platform === 'win32') {
      for (const m of [11, 12, 10, 9])
        list.push({ cmd: 'py', args: [`-3.${m}`] });
      list.push({ cmd: 'python', args: [] }, { cmd: 'python3', args: [] });
    } else {
      list.push(
        { cmd: `python${PYTHON_REQUIRED}`, args: [] },
        { cmd: 'python3', args: [] },
        { cmd: 'python', args: [] },
      );
      for (const m of [12, 10, 9]) list.push({ cmd: `python3.${m}`, args: [] });
    }
    return list;
  }

  private static parseVersion(out: string) {
    const m = /Python\s+(\d+)\.(\d+)\.(\d+)/i.exec(out);
    return m
      ? { major: +m[1], minor: +m[2], text: `${m[1]}.${m[2]}.${m[3]}` }
      : null;
  }

  /** Busca un Python instalado (sin shell). Cada llamada vuelve a verificar. */
  async detect(): Promise<PythonInfo & { cmd?: string; cmdArgs?: string[] }> {
    const base = { requerido: PYTHON_REQUIRED, rango: PYTHON_RANGE };
    let first:
      | {
          c: Candidate;
          v: NonNullable<ReturnType<typeof PythonEnvService.parseVersion>>;
        }
      | undefined;
    for (const c of this.candidates()) {
      let v: ReturnType<typeof PythonEnvService.parseVersion>;
      try {
        const out = await this.proc.execFile(c.cmd, [...c.args, '--version']);
        v = PythonEnvService.parseVersion(`${out.stdout}\n${out.stderr}`);
      } catch {
        continue;
      }
      if (!v || v.major !== 3) continue;
      first ??= { c, v };
      if (v.minor >= PYTHON_MIN_MINOR && v.minor <= PYTHON_MAX_MINOR) {
        return this.describe(base, c, v);
      }
    }
    if (!first) {
      return {
        ...base,
        detectado: false,
        compatible: false,
        motivo: 'No encontramos Python en este equipo.',
        guia: buildGuide(this.so),
      };
    }
    const { c, v } = first;
    return {
      ...base,
      detectado: true,
      version: v.text,
      ejecutable: [c.cmd, ...c.args].join(' '),
      compatible: false,
      motivo:
        v.minor < PYTHON_MIN_MINOR
          ? `Tu Python ${v.text} es demasiado antiguo. Se necesita ${PYTHON_RANGE}.`
          : `Tu Python ${v.text} es demasiado nuevo para el OCR. Se necesita ${PYTHON_RANGE}.`,
      guia: buildGuide(this.so),
    };
  }

  private async describe(
    base: { requerido: string; rango: string },
    c: Candidate,
    v: { text: string },
  ) {
    let cmd = c.cmd;
    let cmdArgs = c.args;
    let ejecutable = [c.cmd, ...c.args].join(' ');
    try {
      const r = await this.proc.execFile(c.cmd, [
        ...c.args,
        '-c',
        'import sys;print(sys.executable)',
      ]);
      const p = r.stdout.trim().split(/\r?\n/).pop()?.trim();
      if (p) {
        cmd = p;
        cmdArgs = [];
        ejecutable = p;
      }
    } catch {
      /* se usa el comando tal cual */
    }
    let venvOk = true;
    try {
      await this.proc.execFile(cmd, [
        ...cmdArgs,
        '-c',
        'import venv, ensurepip',
      ]);
    } catch {
      venvOk = false;
    }
    return {
      ...base,
      detectado: true,
      version: v.text,
      ejecutable,
      compatible: venvOk,
      ...(venvOk
        ? {}
        : {
            motivo:
              'A este Python le falta el módulo "venv" (en Linux, instala python3-venv).',
          }),
      guia: buildGuide(this.so, venvOk ? undefined : 'venv'),
      cmd,
      cmdArgs,
    };
  }

  // ---- estado del entorno ----

  /** El entorno está listo si terminó la instalación y existe el Python del venv. */
  isReady(): boolean {
    return existsSync(this.marker) && existsSync(this.venvPython);
  }

  entornoEstado(): { estado: EnvEstado; mensaje?: string } {
    if (this.estado === 'preparando') return { estado: 'preparando' };
    if (this.isReady()) return { estado: 'listo' };
    if (this.estado === 'error') {
      return { estado: 'error', mensaje: this.mensaje };
    }
    return { estado: 'sin_preparar' };
  }

  progress(): PythonProgress {
    const estado: ProgresoEstado =
      this.estado === 'preparando'
        ? 'preparando'
        : this.estado === 'error'
          ? 'error'
          : this.isReady()
            ? 'listo'
            : 'inactivo';
    return {
      estado,
      lineas: [...this.lineas],
      ...(this.mensaje && estado !== 'listo' ? { mensaje: this.mensaje } : {}),
    };
  }

  onChange(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
        /* un oyente no debe romper la preparación */
      }
    }
  }

  // ---- preparación ----

  private pushLine(raw: string) {
    let l = raw.replace(ANSI, '').trim();
    if (!l) return;
    if (this.home) l = l.split(this.home).join('~');
    if (l.length > MAX_LINE_LEN) l = `${l.slice(0, MAX_LINE_LEN)}…`;
    this.lineas.push(l);
    if (this.lineas.length > MAX_LINES) this.lineas.shift();
  }

  private runStep(
    cmd: string,
    args: string[],
    env: NodeJS.ProcessEnv,
  ): Promise<number> {
    return new Promise((res) => {
      let child: ReturnType<ProcessRunner['spawn']>;
      try {
        child = this.proc.spawn(cmd, args, { env });
      } catch {
        this.pushLine('No se pudo iniciar el proceso.');
        res(-1);
        return;
      }
      let done = false;
      const finish = (code: number) => {
        if (done) return;
        done = true;
        res(code);
      };
      for (const s of [child.stdout, child.stderr]) {
        let buf = '';
        s?.on('data', (d: Buffer | string) => {
          buf += String(d);
          const parts = buf.split(/\r\n|\n|\r/);
          buf = parts.pop() ?? '';
          parts.forEach((p) => this.pushLine(p));
        });
        s?.on('end', () => {
          if (buf) this.pushLine(buf);
          buf = '';
        });
      }
      child.on('error', () => {
        this.pushLine('No se pudo ejecutar Python.');
        finish(-1);
      });
      child.on('exit', (code: number | null) => finish(code ?? -1));
    });
  }

  /** Inicia en segundo plano la creación del venv y la instalación. Idempotente. */
  async prepare(): Promise<{ estado: 'preparando' }> {
    if (this.estado === 'preparando') return { estado: 'preparando' };
    const info = await this.detect();
    if (!info.compatible || !info.cmd) {
      throw new ConflictException(
        info.motivo ?? 'Python no es compatible con el OCR.',
      );
    }
    if (!existsSync(this.requirementsPath)) {
      throw new ConflictException(
        'No se encontró la lista de paquetes del OCR en esta instalación.',
      );
    }
    this.estado = 'preparando';
    this.mensaje = undefined;
    this.lineas = [];
    this.running = this.execute(info.cmd, info.cmdArgs ?? []).catch(() => {
      this.estado = 'error';
      this.mensaje = 'No se pudo preparar el OCR.';
    });
    return { estado: 'preparando' };
  }

  /** Promesa de la preparación en curso (para tests y apagado ordenado). */
  whenIdle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private async execute(cmd: string, cmdArgs: string[]) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PADDLE_PDX_CACHE_HOME: this.modelsDir,
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
      PYTHONUNBUFFERED: '1',
    };
    try {
      mkdirSync(this.modelsDir, { recursive: true });
    } catch {
      this.fail(['Permission denied']);
      return;
    }
    if (!existsSync(this.venvPython)) {
      this.pushLine('Creando el entorno de Python…');
      const code = await this.runStep(
        cmd,
        [...cmdArgs, '-m', 'venv', this.venvDir],
        env,
      );
      if (code !== 0 || !existsSync(this.venvPython)) {
        this.fail(this.lineas);
        return;
      }
    }
    this.pushLine(
      'Instalando los paquetes del OCR (puede tardar varios minutos)…',
    );
    const code = await this.runStep(
      this.venvPython,
      ['-m', 'pip', 'install', '-r', this.requirementsPath],
      env,
    );
    if (code !== 0) {
      this.fail(this.lineas);
      return;
    }
    try {
      writeFileSync(this.marker, new Date().toISOString());
    } catch {
      this.fail(['Permission denied']);
      return;
    }
    this.estado = 'listo';
    this.mensaje = undefined;
    this.pushLine('Listo: el OCR está preparado.');
    this.emit();
  }

  private fail(lines: string[]) {
    this.estado = 'error';
    this.mensaje = mapPrepareError(lines.slice(-MAX_LINES));
    this.emit();
  }
}
