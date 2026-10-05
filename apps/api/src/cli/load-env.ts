import { config } from 'dotenv';
import { resolve } from 'node:path';

/** Carga el .env de la raíz del monorepo (sin pisar variables ya definidas en el entorno). */
export function loadRootEnv() {
  config({ path: resolve(__dirname, '../../../../.env'), quiet: true });
  config({ path: resolve(process.cwd(), '.env'), quiet: true });
}
