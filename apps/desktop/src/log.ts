import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Registro a archivo `<dataDir>/logs/<nombre>.log` (rotación simple a 5 MB). Sin contenido de usuarios ni secretos. */
export function createLogger(dataDir: string, name: string): (msg: string) => void {
  const dir = join(dataDir, 'logs');
  const file = join(dir, `${name}.log`);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* sin logs */
  }
  return (msg: string) => {
    try {
      try {
        if (statSync(file).size > 5_000_000) renameSync(file, file + '.1');
      } catch {
        /* no existe aún */
      }
      appendFileSync(file, `${new Date().toISOString()} ${msg}\n`);
    } catch {
      /* el log nunca debe tumbar la app */
    }
  };
}
