import { Injectable } from '@nestjs/common';

export type PullEstado = 'descargando' | 'listo' | 'error' | 'inactivo';

export interface PullStatus {
  modelo: string;
  estado: PullEstado;
  completado: number;
  total: number;
  error?: string;
}

export interface OllamaInfo {
  alcanzable: boolean;
  version?: string;
  modelos: string[];
  /** Versión mínima de Ollama para el modelo recomendado (Qwen3-VL). */
  versionMinima: string;
  /** true si Ollama responde pero su versión es anterior a `versionMinima`. */
  requiereActualizar?: boolean;
  /** Por qué no es alcanzable (solo si `alcanzable` es false). */
  motivo?: 'rechazada' | 'tiempo' | 'invalida';
  /** URL que sí respondió, cuando difiere de la configurada (solo `detect`). */
  urlDetectada?: string;
}

const REFUSED_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function failureReason(err: unknown): 'rechazada' | 'tiempo' | undefined {
  const e = err as {
    name?: string;
    code?: string;
    cause?: { code?: string };
  } | null;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'tiempo';
  const code = e?.cause?.code ?? e?.code;
  if (code && REFUSED_CODES.has(code)) return 'rechazada';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'tiempo';
  }
  return undefined;
}

/** Qwen3-VL exige Ollama 0.12.7 o superior (https://ollama.com/library/qwen3-vl). */
export const OLLAMA_MIN_VERSION = '0.12.7';

/** Compara versiones tipo "0.12.7" (ignora sufijos como -rc1). Versión ilegible => true (no molestar). */
export function versionAtLeast(version: string, min: string): boolean {
  const parse = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const a = parse(version);
  const b = parse(min);
  if (!a || !b) return true;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

const QUICK_TIMEOUT_MS = 2500;
const PULL_CONNECT_TIMEOUT_MS = 15_000;
const PULL_IDLE_TIMEOUT_MS = 120_000;
const KEEP_FINISHED_MS = 30 * 60_000;
const MODEL_RE = /^[A-Za-z0-9._:/-]{1,200}$/;

/** Base nativa de Ollama: la URL configurada (compatible OpenAI) sin el sufijo `/v1`. */
export function ollamaNativeBase(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '')
    .replace(/\/+$/, '');
}

export function isValidModelName(m: unknown): m is string {
  return typeof m === 'string' && MODEL_RE.test(m);
}

function httpBase(url: string): string | null {
  try {
    const u = new URL(ollamaNativeBase(url));
    return u.protocol === 'http:' || u.protocol === 'https:'
      ? ollamaNativeBase(url)
      : null;
  } catch {
    return null;
  }
}

const MSG_DISCO =
  'No hay espacio suficiente en el disco; se necesitan unos 4 GB libres.';
const MSG_MODELO =
  'Ollama no encontró ese modelo; revisa el nombre o actualiza Ollama.';
const MSG_VERSION =
  'Este modelo necesita una versión más reciente de Ollama; actualízala e inténtalo de nuevo.';
const MSG_RED = 'No se pudo descargar: revisa tu conexión a internet.';
const MSG_GENERICO = 'Ollama no pudo descargar el modelo.';

/**
 * Traduce el error crudo de Ollama a un texto claro en español. Función pura:
 * el texto crudo nunca se devuelve ni se guarda.
 */
export function mapPullError(raw: string): string {
  const t = String(raw ?? '').toLowerCase();
  const has = (...parts: string[]) => parts.some((p) => t.includes(p));
  if (has('no space left', 'disk full', 'not enough space')) return MSG_DISCO;
  if (has('newer version of ollama', 'requires a newer')) return MSG_VERSION;
  if (has('not found', 'file does not exist', 'manifest')) return MSG_MODELO;
  if (
    has(
      'connection',
      'timeout',
      'timed out',
      'no such host',
      'dial tcp',
      'network',
      'eof',
      'fetch failed',
      'abort',
    )
  ) {
    return MSG_RED;
  }
  return MSG_GENERICO;
}

interface Entry extends PullStatus {
  updatedAt: number;
}

/** Cliente mínimo de la API nativa de Ollama (lista, versión y descarga de modelos). */
@Injectable()
export class OllamaService {
  private readonly pulls = new Map<string, Entry>();

  private async getJson(
    base: string,
    path: string,
    timeoutMs = QUICK_TIMEOUT_MS,
  ): Promise<unknown> {
    // redirect: 'manual' evita seguir redirecciones hacia otros hosts.
    const res = await fetch(`${base}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async listModels(url: string): Promise<string[]> {
    const base = httpBase(url);
    if (!base) return [];
    try {
      const data = (await this.getJson(base, '/api/tags')) as {
        models?: { name?: unknown }[];
      };
      return (data.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => typeof n === 'string');
    } catch {
      return [];
    }
  }

  async info(url: string): Promise<OllamaInfo> {
    const base = httpBase(url);
    if (!base) {
      return {
        alcanzable: false,
        modelos: [],
        versionMinima: OLLAMA_MIN_VERSION,
        motivo: 'invalida',
      };
    }
    try {
      const v = (await this.getJson(base, '/api/version')) as {
        version?: unknown;
      };
      const modelos = await this.listModels(url);
      const version = typeof v.version === 'string' ? v.version : undefined;
      return {
        alcanzable: true,
        version,
        modelos,
        versionMinima: OLLAMA_MIN_VERSION,
        requiereActualizar:
          version !== undefined && !versionAtLeast(version, OLLAMA_MIN_VERSION),
      };
    } catch (err) {
      const out: OllamaInfo = {
        alcanzable: false,
        modelos: [],
        versionMinima: OLLAMA_MIN_VERSION,
      };
      const motivo = failureReason(err);
      if (motivo) out.motivo = motivo;
      return out;
    }
  }

  /**
   * Prueba la URL configurada y luego las candidatas (en serie, sin repetir).
   * Devuelve la info de la primera alcanzable; `urlDetectada` solo si no es la configurada.
   * Si ninguna responde, devuelve la info de la configurada.
   */
  async detect(
    urlConfigurada: string,
    candidatas: string[],
  ): Promise<OllamaInfo> {
    const first = await this.info(urlConfigurada);
    if (first.alcanzable) return first;
    const seen = new Set([urlConfigurada.trim()]);
    for (const c of candidatas) {
      const url = c.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const info = await this.info(url);
      if (info.alcanzable) return { ...info, urlDetectada: url };
    }
    return first;
  }

  status(modelo: string): PullStatus {
    this.cleanup();
    const e = this.pulls.get(modelo);
    if (!e) return { modelo, estado: 'inactivo', completado: 0, total: 0 };
    const out: PullStatus = {
      modelo,
      estado: e.estado,
      completado: e.completado,
      total: e.total,
    };
    if (e.error) out.error = e.error;
    return out;
  }

  /** Inicia la descarga en segundo plano (idempotente si ya hay una en curso). */
  startPull(url: string, modelo: string): PullStatus {
    this.cleanup();
    const current = this.pulls.get(modelo);
    if (current?.estado === 'descargando') return this.status(modelo);
    const entry: Entry = {
      modelo,
      estado: 'descargando',
      completado: 0,
      total: 0,
      updatedAt: Date.now(),
    };
    this.pulls.set(modelo, entry);
    const base = httpBase(url);
    if (!base) {
      this.fail(entry, 'La dirección de Ollama no es válida.');
      return this.status(modelo);
    }
    void this.runPull(base, entry);
    return this.status(modelo);
  }

  private fail(e: Entry, msg: string) {
    e.estado = 'error';
    e.error = msg;
    e.updatedAt = Date.now();
  }

  private async runPull(base: string, e: Entry): Promise<void> {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), PULL_CONNECT_TIMEOUT_MS);
    timer.unref();
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), PULL_IDLE_TIMEOUT_MS);
      timer.unref();
    };
    try {
      const res = await fetch(`${base}/api/pull`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: e.modelo, stream: true }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        this.fail(
          e,
          res.status === 404
            ? MSG_MODELO
            : 'Ollama no pudo iniciar la descarga.',
        );
        return;
      }
      touch();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let failed = false;
      let success = false;
      const handle = (line: string) => {
        if (!line.trim()) return;
        let msg: {
          status?: string;
          error?: unknown;
          completed?: number;
          total?: number;
        };
        try {
          msg = JSON.parse(line) as typeof msg;
        } catch {
          return;
        }
        if (msg.error !== undefined) {
          failed = true;
          this.fail(
            e,
            mapPullError(typeof msg.error === 'string' ? msg.error : ''),
          );
          return;
        }
        if (typeof msg.total === 'number' && msg.total > 0) {
          e.total = msg.total;
          e.completado =
            typeof msg.completed === 'number' ? msg.completed : e.completado;
        }
        if (msg.status === 'success') success = true;
        e.updatedAt = Date.now();
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        touch();
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          handle(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      }
      handle(buf);
      if (failed) return;
      if (success) {
        e.estado = 'listo';
        if (e.total > 0) e.completado = e.total;
        e.updatedAt = Date.now();
      } else {
        this.fail(e, 'La descarga se interrumpió.');
      }
    } catch {
      this.fail(e, MSG_RED);
    } finally {
      clearTimeout(timer);
    }
  }

  private cleanup() {
    const now = Date.now();
    for (const [k, v] of this.pulls) {
      if (v.estado !== 'descargando' && now - v.updatedAt > KEEP_FINISHED_MS) {
        this.pulls.delete(k);
      }
    }
  }
}
