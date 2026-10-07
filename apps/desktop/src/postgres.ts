import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { buildDatabaseUrl } from './api-env';
import { getFreePort } from './ports';

export const PG_USER = 'automed';
export const PG_DB = 'automed';

/** ¿El postmaster.pid apunta a un proceso que ya no existe? (puro: `isAlive` se inyecta). */
export function isStalePostmasterPid(
  content: string,
  isAlive: (pid: number) => boolean,
): boolean {
  const pid = Number.parseInt(content.split(/\r?\n/)[0] ?? '', 10);
  if (!Number.isInteger(pid) || pid <= 0) return true;
  return !isAlive(pid);
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Borra `postmaster.pid` si quedó de un cierre brusco. Devuelve true si lo borró. */
export function cleanStalePostmasterPid(
  pgData: string,
  isAlive: (pid: number) => boolean = processIsAlive,
): boolean {
  const file = join(pgData, 'postmaster.pid');
  if (!existsSync(file)) return false;
  let content = '';
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  if (!isStalePostmasterPid(content, isAlive)) return false;
  rmSync(file, { force: true });
  return true;
}

/** PID del postmaster vivo que usa `pgData` (según postmaster.pid), o null. */
export function livePostmasterPid(
  pgData: string,
  isAlive: (pid: number) => boolean = processIsAlive,
): number | null {
  const file = join(pgData, 'postmaster.pid');
  if (!existsSync(file)) return null;
  try {
    const pid = Number.parseInt(readFileSync(file, 'utf8').split(/\r?\n/)[0] ?? '', 10);
    return Number.isInteger(pid) && pid > 0 && isAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

type PgInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createDatabase(name: string): Promise<void>;
  getPgClient(db?: string, host?: string): {
    connect(): Promise<void>;
    query(q: string, p?: unknown[]): Promise<{ rows: unknown[] }>;
    end(): Promise<void>;
  };
  process?: { on(ev: 'exit', cb: () => void): void };
};

export interface PostgresOptions {
  dataDir: string;
  password: string;
  log: (msg: string) => void;
  /** Se invoca si Postgres muere sin que lo hayamos pedido. */
  onUnexpectedExit?: () => void;
  attempts?: number;
}

export class PostgresManager {
  private pg: PgInstance | null = null;
  private stopping = false;
  port = 0;
  private readonly pgData: string;

  constructor(private readonly opts: PostgresOptions) {
    this.pgData = join(opts.dataDir, 'pg-data');
  }

  get databaseUrl(): string {
    return buildDatabaseUrl(this.opts.password, this.port, PG_DB, PG_USER);
  }

  async start(): Promise<void> {
    const attempts = this.opts.attempts ?? 3;
    let lastError: unknown;
    for (let i = 1; i <= attempts; i++) {
      try {
        await this.startOnce();
        return;
      } catch (e) {
        lastError = e;
        this.opts.log(`Postgres: intento ${i}/${attempts} falló (${errMsg(e)})`);
        await this.forceStopQuietly();
        await new Promise((r) => setTimeout(r, 500 * i));
      }
    }
    throw new Error(`No se pudo iniciar la base de datos: ${errMsg(lastError)}`);
  }

  private async startOnce(): Promise<void> {
    cleanStalePostmasterPid(this.pgData);
    await this.stopOrphan();
    this.port = await getFreePort();
    const mod = (await import('embedded-postgres')) as unknown as {
      default: new (o: Record<string, unknown>) => PgInstance;
    };
    const pg = new mod.default({
      databaseDir: this.pgData,
      user: PG_USER,
      password: this.opts.password,
      port: this.port,
      authMethod: 'scram-sha-256',
      persistent: true,
      initdbFlags: ['--encoding=UTF8'],
      postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories='],
      // Los mensajes de initdb/postgres pueden incluir rutas; no contienen datos de usuarios.
      onLog: () => undefined,
      onError: () => undefined,
    });
    this.pg = pg;
    this.stopping = false;
    if (!existsSync(join(this.pgData, 'PG_VERSION'))) {
      this.opts.log('Postgres: creando la base de datos (primer arranque)');
      await pg.initialise();
    }
    await pg.start();
    pg.process?.on('exit', () => {
      if (!this.stopping) this.opts.onUnexpectedExit?.();
    });
    await this.ensureDatabase(pg);
    this.opts.log(`Postgres: listo en 127.0.0.1:${this.port}`);
  }

  private async ensureDatabase(pg: PgInstance): Promise<void> {
    const client = pg.getPgClient('postgres', '127.0.0.1');
    await client.connect();
    try {
      const r = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [PG_DB]);
      if (r.rows.length === 0) await pg.createDatabase(PG_DB);
    } finally {
      await client.end();
    }
  }

  /** Parada ordenada (modo fast). */
  async stop(timeoutMs = 30_000): Promise<void> {
    const pg = this.pg;
    if (!pg) return;
    this.stopping = true;
    this.pg = null;
    if (process.platform === 'win32') {
      // La librería usa `taskkill /f` en Windows; antes se intenta `pg_ctl stop -m fast`.
      const ok = await this.pgCtlStopFast().catch(() => false);
      if (ok) {
        // Deja que la librería limpie su estado; el proceso ya terminó.
        await Promise.race([pg.stop().catch(() => undefined), delay(3000)]);
        return;
      }
    }
    await Promise.race([pg.stop(), delay(timeoutMs)]);
  }

  /**
   * Si la app anterior murió de golpe, su Postgres puede seguir vivo con la misma carpeta de datos.
   * Se le pide parada rápida (solo si se confirma que es nuestro Postgres) y se espera a que salga.
   */
  private async stopOrphan(): Promise<void> {
    const pid = livePostmasterPid(this.pgData);
    if (pid === null) return;
    this.opts.log('Postgres: quedó un servidor anterior abierto; cerrándolo');
    if (process.platform === 'win32') {
      await this.pgCtlStopFast().catch(() => false);
    } else {
      let ours = false;
      try {
        ours = readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(this.pgData);
      } catch {
        ours = false; // sin /proc (otros sistemas): no se toca nada
      }
      if (!ours) return;
      try {
        process.kill(pid, 'SIGINT');
      } catch {
        return;
      }
    }
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && processIsAlive(pid)) await delay(250);
    cleanStalePostmasterPid(this.pgData);
  }

  private async forceStopQuietly() {
    try {
      await this.stop(4_000);
    } catch {
      /* ya estaba detenido */
    }
  }

  private async pgCtlStopFast(): Promise<boolean> {
    const req = createRequire(require.resolve('embedded-postgres'));
    const bin = req.resolve('@embedded-postgres/windows-x64').replace(/dist[\\/]index\.js$/, '');
    const pgCtl = join(bin, 'native', 'bin', 'pg_ctl.exe');
    if (!existsSync(pgCtl)) return false;
    return new Promise<boolean>((resolve) => {
      const p = spawn(pgCtl, ['stop', '-D', this.pgData, '-m', 'fast', '-w', '-t', '30'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      p.on('exit', (code) => resolve(code === 0));
      p.on('error', () => resolve(false));
    });
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
function errMsg(e: unknown) {
  return e instanceof Error ? e.message.split('\n')[0] : 'error desconocido';
}
