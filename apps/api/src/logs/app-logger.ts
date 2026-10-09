import { ConsoleLogger, Injectable, type LogLevel } from '@nestjs/common';
import { LogBufferService, type LogNivel } from './log-buffer.service';

/** Cuántas líneas de la pila se guardan en el buffer (stdout recibe la pila completa). */
const STACK_LINES = 3;

/**
 * Logger de la API: escribe en stdout como el ConsoleLogger de Nest y, además, guarda cada línea
 * (saneada) en LogBufferService para verla en Ajustes -> Registro. Se instala en main.ts con
 * `app.useLogger(app.get(AppLogger))` (y `bufferLogs: true` para no perder el arranque).
 */
@Injectable()
export class AppLogger extends ConsoleLogger {
  constructor(private readonly buffer: LogBufferService) {
    super();
  }

  override log(message: unknown, ...params: unknown[]) {
    super.log(message, ...params);
    this.capture('log', 'log', message, params);
  }

  override warn(message: unknown, ...params: unknown[]) {
    super.warn(message, ...params);
    this.capture('warn', 'warn', message, params);
  }

  override error(message: unknown, ...params: unknown[]) {
    super.error(message, ...params);
    this.capture('error', 'error', message, params, true);
  }

  override fatal(message: unknown, ...params: unknown[]) {
    super.fatal(message, ...params);
    this.capture('fatal', 'error', message, params, true);
  }

  override debug(message: unknown, ...params: unknown[]) {
    super.debug(message, ...params);
    this.capture('debug', 'debug', message, params);
  }

  override verbose(message: unknown, ...params: unknown[]) {
    super.verbose(message, ...params);
    this.capture('verbose', 'verbose', message, params);
  }

  private capture(
    level: LogLevel,
    nivel: LogNivel,
    message: unknown,
    params: unknown[],
    withStack = false,
  ) {
    if (!this.isLevelEnabled(level)) return;
    const rest = [...params];
    // Convención de Nest: el último parámetro de texto es el contexto.
    const last = rest[rest.length - 1];
    const contexto =
      typeof last === 'string' && !last.includes('\n')
        ? (rest.pop() as string)
        : (this.context ?? 'api');
    let texto = this.toText(message);
    if (withStack && typeof rest[0] === 'string' && rest[0].includes('\n')) {
      const frames = rest[0]
        .split('\n')
        .slice(1, 1 + STACK_LINES)
        .map((l) => l.trim());
      if (frames.length) texto += ` | ${frames.join(' | ')}`;
    }
    this.buffer.append(nivel, contexto, texto);
  }

  private toText(message: unknown): string {
    if (message instanceof Error) return `${message.name}: ${message.message}`;
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }
}
