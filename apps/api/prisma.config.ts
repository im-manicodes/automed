import { config } from 'dotenv';
import { resolve } from 'node:path';

import { defineConfig } from 'prisma/config';

config({ path: resolve(__dirname, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Lo usan `prisma db seed` y `db:seed` (tsx resuelve los imports .js del cliente generado; no requiere build).
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://automed:automed@localhost:5432/automed',
  },
});
