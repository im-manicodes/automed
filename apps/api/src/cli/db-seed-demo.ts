/**
 * Datos DEMO ficticios (solo desarrollo; se niega con NODE_ENV=production).
 *   pnpm db:seed:demo          crea/recrea los datos demo (ids "demo-", asuntos "[DEMO]") y sube imágenes a RustFS
 *   pnpm db:seed:demo:clean    borra únicamente lo demo (BD por prefijo de id y objetos S3 "demo/")
 */
import { loadRootEnv } from './load-env';
import { createPgAdapter } from '../prisma/prisma.service';
import { PrismaClient } from '../generated/prisma/client';
import { StorageService } from '../storage/storage.service';
import { renderDemoPage } from '../seed/page-image';
import { assertNotProduction, cleanDemo, seedDemo } from '../seed/seed-demo';
import type { ConfigService } from '@nestjs/config';

loadRootEnv();

async function main() {
  const clean = process.argv.slice(2).includes('--clean');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (.env raíz)');
  if (!clean) assertNotProduction(process.env, 'db:seed:demo');
  const storage = process.env.S3_ENDPOINT
    ? new StorageService({
        get: (k: string, d?: string) => process.env[k] ?? d,
      } as unknown as ConfigService)
    : null;
  const prisma = new PrismaClient({ adapter: createPgAdapter(url) });
  try {
    if (clean) await cleanDemo(prisma, storage, (m) => console.log(m));
    else
      await seedDemo(
        prisma,
        storage,
        process.env,
        (m) => console.log(m),
        renderDemoPage,
      );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`Error: ${e instanceof Error ? e.message : 'desconocido'}`);
  process.exit(1);
});
