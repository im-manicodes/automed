/**
 * Seed base (idempotente): plantilla activa, ajustes y, opcional y solo en desarrollo, un usuario.
 *   pnpm db:seed        (desde la raíz)   ·   también lo invoca `prisma db seed` / `migrate reset`
 * Variables opcionales: SEED_USER_EMAIL, SEED_USER_NAME, SEED_USER_PASSWORD (nunca se imprimen).
 */
import { loadRootEnv } from './load-env';
import { createPgAdapter } from '../prisma/prisma.service';
import { PrismaClient } from '../generated/prisma/client';
import { PasswordService } from '../auth/password.service';
import { seedBase } from '../seed/seed-base';

loadRootEnv();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (.env raíz)');
  const prisma = new PrismaClient({ adapter: createPgAdapter(url) });
  try {
    await seedBase(prisma, new PasswordService(), process.env, (m) =>
      console.log(m),
    );
    console.log('Seed base terminado.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`Error: ${e instanceof Error ? e.message : 'desconocido'}`);
  process.exit(1);
});
