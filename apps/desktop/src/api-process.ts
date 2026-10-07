export interface ApiChild {
  on(ev: 'message', cb: (m: unknown) => void): unknown;
  on(ev: 'exit', cb: (code: number) => void): unknown;
  postMessage(m: unknown): void;
  kill(): boolean;
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
}

export type ForkFn = (
  entry: string,
  args: string[],
  opts: { env: Record<string, string>; stdio: 'pipe'; serviceName: string },
) => ApiChild;

export interface ApiProcessOptions {
  fork: ForkFn;
  entry: string;
  env: Record<string, string>;
  log: (msg: string) => void;
  onLine?: (line: string) => void;
  onUnexpectedExit?: (code: number) => void;
  readyTimeoutMs?: number;
}

export class ApiProcess {
  private child: ApiChild | null = null;
  private stopping = false;
  port = 0;

  constructor(private readonly o: ApiProcessOptions) {}

  /** Lanza la API y espera su mensaje `{type:'ready', port}`. */
  start(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.stopping = false;
      const child = this.o.fork(this.o.entry, [], {
        env: this.o.env,
        stdio: 'pipe',
        serviceName: 'auto-med-api',
      });
      this.child = child;
      const forward = (s?: NodeJS.ReadableStream | null) =>
        s?.on('data', (d: Buffer) => {
          for (const line of d.toString('utf8').split(/\r?\n/)) {
            if (line.trim()) this.o.onLine?.(line);
          }
        });
      forward(child.stdout);
      forward(child.stderr);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('La aplicación tardó demasiado en iniciar.'));
      }, this.o.readyTimeoutMs ?? 90_000);
      child.on('message', (m) => {
        const msg = m as { type?: string; port?: number };
        if (msg?.type === 'ready' && typeof msg.port === 'number' && !settled) {
          settled = true;
          clearTimeout(timer);
          this.port = msg.port;
          resolve(msg.port);
        }
      });
      child.on('exit', (code) => {
        if (this.child === child) this.child = null;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`La aplicación se cerró al iniciar (código ${code}).`));
        } else if (!this.stopping) {
          this.o.onUnexpectedExit?.(code);
        }
      });
    });
  }

  /** Cierre ordenado: mensaje `shutdown`; si no sale en `graceMs`, se mata. */
  async stop(graceMs = 10_000): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ya terminó */
        }
        resolve();
      }, graceMs);
      child.on('exit', () => {
        clearTimeout(t);
        resolve();
      });
      try {
        child.postMessage('shutdown');
      } catch {
        child.kill();
      }
    });
    this.child = null;
  }
}

/** Espera a que GET /api/health responda 2xx; devuelve el JSON. */
export async function waitForHealth(
  port: number,
  timeoutMs = 60_000,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last = 'sin respuesta';
  while (Date.now() < deadline) {
    try {
      const r = await fetchFn(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return (await r.json()) as Record<string, unknown>;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : 'error';
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`La aplicación no respondió a tiempo (${last}).`);
}
