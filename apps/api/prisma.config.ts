import { config } from 'dotenv';
import { resolve } from 'node:path';

import { defineConfig } from 'prisma/config';

config({ path: resolve(__dirname, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Lo usan `prisma db seed` y `migrate reset`. Requiere el build previo (`pnpm build` -> dist/cli/db-seed.js)
    // y correr desde apps/api (como hacen los scripts del package.json).
    seed: 'node dist/cli/db-seed.js',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://automed:automed@localhost:5432/automed',
  },
});
