import { Inject, Injectable, Optional } from '@nestjs/common';

export type LogNivel = 'error' | 'warn' | 'log' | 'debug' | 'verbose';

export const LOG_NIVELES: readonly LogNivel[] = [
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
];

export interface LogEntry {
  id: number;
  /** ISO 8601. */
  ts: string;
  nivel: LogNivel;
  contexto: string;
  mensaje: string;
}

export interface LogQuery {
  /** Nivel mínimo de gravedad: 'warn' devuelve warn + error. */
  nivel?: LogNivel;
  /** Solo entradas con id > desde (polling incremental). */
  desde?: number;
  /** Texto a buscar (sin distinguir mayúsculas) en mensaje o contexto. */
  q?: string;
  /** Máximo de entradas (las más recientes). */
  limit?: number;
}

export const LOG_BUFFER_CAPACITY = 2000;
/** Token opcional para cambiar la capacidad (pruebas). */
export const LOG_BUFFER_CAPACITY_TOKEN = 'LOG_BUFFER_CAPACITY';
export const LOG_MAX_MESSAGE = 500;

const SEVERIDAD: Record<LogNivel, number> = {
  error: 0,
  warn: 1,
  log: 2,
  debug: 3,
  verbose: 4,
};

const REDACCIONES: [RegExp, string][] = [
  // Cabeceras Authorization / Bearer.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [oculto]'],
  // Claves de proveedores (OpenAI sk-..., Anthropic sk-ant-...).
  [/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-[oculto]'],
  // JWT (tres segmentos base64url).
  [
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
    '[token oculto]',
  ],
  // Claves de acceso de AWS.
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[clave AWS oculta]'],
  // pares clave=valor / "clave": "valor" con nombres sensibles.
  [
    /\b(access_token|refresh_token|id_token|client_secret|password|contraseña|secret|api[_-]?key|token|authorization|cookie)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi,
    '$1$2[oculto]',
  ],
  // Correos electrónicos.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[correo oculto]'],
];

/** Enmascara secretos/correos y recorta a LOG_MAX_MESSAGE caracteres. */
export function sanitizeLogMessage(input: string): string {
  let s = input;
  for (const [re, rep] of REDACCIONES) s = s.replace(re, rep);
  if (s.length > LOG_MAX_MESSAGE) {
    s = `${s.slice(0, LOG_MAX_MESSAGE)}… [recortado]`;
  }
  return s;
}

/** Convierte cualquier valor a texto para el registro (Error -> nombre: mensaje). */
export function stringifyLogValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '[valor no serializable]';
  }
}

/**
 * Buffer circular en memoria con las últimas líneas de log de la API (se pierde al reiniciar).
 * Todo lo que entra se sanea (secretos, correos, longitud). Lo alimentan AppLogger y quien
 * necesite registrar salida propia (p. ej. el instalador del OCR local) con `append`.
 */
@Injectable()
export class LogBufferService {
  private readonly entries: LogEntry[] = [];
  private nextId = 1;

  private readonly capacity: number;

  constructor(
    @Optional() @Inject(LOG_BUFFER_CAPACITY_TOKEN) capacity?: number,
  ) {
    this.capacity = capacity && capacity > 0 ? capacity : LOG_BUFFER_CAPACITY;
  }

  /** Añade una línea (saneada) y devuelve la entrada guardada. */
  append(nivel: LogNivel, contexto: string, mensaje: unknown): LogEntry {
    const entry: LogEntry = {
      id: this.nextId++,
      ts: new Date().toISOString(),
      nivel,
      contexto: sanitizeLogMessage(contexto || 'api').slice(0, 80),
      mensaje: sanitizeLogMessage(stringifyLogValue(mensaje)),
    };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
    return entry;
  }

  /** Atajo para módulos que registran salida de procesos (etiqueta = contexto). */
  forContext(contexto: string) {
    return {
      log: (m: unknown) => this.append('log', contexto, m),
      warn: (m: unknown) => this.append('warn', contexto, m),
      error: (m: unknown) => this.append('error', contexto, m),
      debug: (m: unknown) => this.append('debug', contexto, m),
    };
  }

  query(opts: LogQuery = {}): { entries: LogEntry[]; ultimoId: number } {
    const max = opts.nivel ? SEVERIDAD[opts.nivel] : Infinity;
    const q = opts.q?.trim().toLowerCase();
    const desde = opts.desde ?? 0;
    let out = this.entries.filter(
      (e) =>
        e.id > desde &&
        SEVERIDAD[e.nivel] <= max &&
        (!q ||
          e.mensaje.toLowerCase().includes(q) ||
          e.contexto.toLowerCase().includes(q)),
    );
    const limit = opts.limit ?? this.capacity;
    if (out.length > limit) out = out.slice(out.length - limit);
    return { entries: out, ultimoId: this.nextId - 1 };
  }

  /** Últimas `n` líneas de un contexto (para mostrar el progreso de una tarea). */
  tail(contexto: string, n = 20): LogEntry[] {
    const out: LogEntry[] = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < n; i--) {
      if (this.entries[i].contexto === contexto) out.unshift(this.entries[i]);
    }
    return out;
  }

  /** Texto plano para descargar. */
  toText(): string {
    return this.entries
      .map(
        (e) =>
          `${e.ts} ${e.nivel.toUpperCase().padEnd(7)} [${e.contexto}] ${e.mensaje}`,
      )
      .join('\n');
  }

  /** Vacía el buffer (los ids siguen creciendo para no confundir al polling). */
  clear(): void {
    this.entries.length = 0;
  }

  size(): number {
    return this.entries.length;
  }
}
