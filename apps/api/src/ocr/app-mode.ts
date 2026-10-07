import { join } from 'path';

/** APP_MODE=desktop lo fija el instalable de escritorio (Electron). */
export const isDesktop = (config: {
  get<T = string>(k: string): T | undefined;
}) => config.get<string>('APP_MODE') === 'desktop';

/** Carpeta de datos del usuario (modo escritorio) para el entorno de Python. */
export const pythonDir = (config: {
  get<T = string>(k: string): T | undefined;
}) =>
  join(config.get<string>('DATA_DIR') ?? join(process.cwd(), 'data'), 'python');
