/**
 * PELIGROSO: borra TODOS los datos del esquema destino, reaplica las migraciones y corre el seed base.
 *   pnpm db:reset
 *   pnpm db:reset -- --force --i-understand     (solo CI / esquemas temporales; nunca sobre "public")
 * Protecciones: se niega con NODE_ENV=production; muestra servidor/puerto/base/esquema (sin contraseña);
 * exige escribir el nombre exacto de la base. Prisma puede pedir además su propio consentimiento para
 * acciones destructivas ejecutadas por agentes: esa variable la define solo el usuario, nunca un script.
 */
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { loadRootEnv } from './load-env';
import {
  checkResetAllowed,
  describeTarget,
  isConfirmationValid,
  parseResetArgs,
} from './reset-guard';

loadRootEnv();

async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'Se requiere una terminal interactiva para confirmar (o --force --i-understand en CI/esquemas temporales).',
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseResetArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (.env raíz)');
  const target = describeTarget(url);
  console.log('db:reset va a BORRAR TODOS LOS DATOS de:');
  console.log(`  servidor: ${target.host}`);
  console.log(`  puerto:   ${target.port}`);
  console.log(`  base:     ${target.database}`);
  console.log(`  esquema:  ${target.schema}`);
  const decision = checkResetAllowed(process.env.NODE_ENV, target, args);
  if (!decision.ok) throw new Error(decision.reason);
  if (decision.needsTypedConfirmation) {
    const typed = await ask(
      `Para confirmar escribe el nombre exacto de la base (${target.database}): `,
    );
    if (!isConfirmationValid(typed, target)) {
      throw new Error('Confirmación incorrecta: no se hizo ningún cambio.');
    }
  }
  const apiDir = resolve(__dirname, '../..');
  // Prisma 7 ya no siembra solo tras el reset: el seed base se lanza una sola vez, abajo.
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'reset', '--force'], {
    cwd: apiDir,
    stdio: 'inherit',
    env: process.env,
  });
  execFileSync('pnpm', ['exec', 'prisma', 'db', 'seed'], {
    cwd: apiDir,
    stdio: 'inherit',
    env: process.env,
  });
  console.log(
    'Reset terminado (migraciones reaplicadas y seed base ejecutado).',
  );
}

main().catch((e: unknown) => {
  console.error(`Error: ${e instanceof Error ? e.message : 'desconocido'}`);
  process.exit(1);
});
