/**
 * Corre el flujo completo con mocks (src/e2e-flow.integration.spec.ts) en un ESQUEMA TEMPORAL
 * de la BD de DATABASE_URL (.env raíz): lo crea, aplica las migraciones, ejecuta el test y lo
 * borra SIEMPRE al terminar. No toca otros esquemas ni datos existentes. Sin red.
 * Uso: pnpm --filter api test:e2e-flow
 */
import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';

config({ path: resolve(__dirname, '../../../.env') });

const base = process.env.DATABASE_URL;
if (!base) {
  console.error('Falta DATABASE_URL (.env raíz) para crear el esquema temporal.');
  process.exit(1);
}
const schema = `e2e_flow_${Date.now().toString(36)}`;
const u = new URL(base);
u.searchParams.set('schema', schema);
const testUrl = u.toString();
// pg no entiende ?schema=; se conecta sin él.
const pgUrl = new URL(base);
pgUrl.searchParams.delete('schema');

async function withClient(sql: string) {
  const c = new Client({ connectionString: pgUrl.toString() });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

async function main() {
  if (!/^e2e_flow_[a-z0-9]+$/.test(schema)) throw new Error('esquema inválido');
  let code = 0;
  await withClient(`CREATE SCHEMA "${schema}"`);
  try {
    const env = { ...process.env, DATABASE_URL: testUrl };
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', env });
    execFileSync(
      'npx',
      ['jest', 'src/e2e-flow.integration.spec.ts', '--runInBand'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          TEST_DATABASE_URL: testUrl,
          NODE_OPTIONS: '--experimental-vm-modules',
        },
      },
    );
  } catch {
    code = 1;
  } finally {
    await withClient(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    console.log(`Esquema temporal ${schema} eliminado.`);
  }
  process.exit(code);
}
void main();
