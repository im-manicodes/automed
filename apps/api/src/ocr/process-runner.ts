import { execFile, spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createServer } from 'net';

/** Subconjunto de ChildProcess que usamos (fácil de simular en tests). */
export type SpawnedProcess = Pick<
  ChildProcess,
  'stdout' | 'stderr' | 'on' | 'kill'
>;

/**
 * Acceso a procesos y red local, inyectable para poder probar sin lanzar Python de verdad.
 * Nunca usa shell: los argumentos van como arreglo.
 */
export interface ProcessRunner {
  execFile(
    cmd: string,
    args: string[],
    opts?: { timeoutMs?: number },
  ): Promise<{ stdout: string; stderr: string }>;
  spawn(
    cmd: string,
    args: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): SpawnedProcess;
  freePort(): Promise<number>;
  health(
    url: string,
    timeoutMs?: number,
  ): Promise<{ ok: boolean; fallbackReason?: string | null }>;
}

export const PROCESS_RUNNER = Symbol('PROCESS_RUNNER');

export const defaultProcessRunner: ProcessRunner = {
  execFile: (cmd, args, opts) =>
    new Promise((resolve, reject) => {
      execFile(
        cmd,
        args,
        { timeout: opts?.timeoutMs ?? 10_000, windowsHide: true },
        (err, stdout, stderr) =>
          err ? reject(new Error(err.message)) : resolve({ stdout, stderr }),
      );
    }),
  spawn: (cmd, args, opts) =>
    spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  freePort: () =>
    new Promise((resolve, reject) => {
      const srv = createServer();
      srv.once('error', (e) => reject(e));
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close(() =>
          port ? resolve(port) : reject(new Error('sin puerto')),
        );
      });
    }),
  health: async (url, timeoutMs = 3000) => {
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { ok: false };
      const body = (await res.json()) as {
        ok?: boolean;
        fallback_reason?: string | null;
      };
      return { ok: body.ok !== false, fallbackReason: body.fallback_reason };
    } catch {
      return { ok: false };
    }
  },
};
