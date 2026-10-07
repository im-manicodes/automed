import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { listMigrations, runMigrations } from './migrate-runner';

/**
 * Integración con un PostgreSQL embebido temporal (paquete `embedded-postgres`, solo desarrollo).
 * Es opt-in porque descarga/arranca un binario: `pnpm --filter api test:migrator`
 * (equivale a RUN_EMBEDDED_PG=1 con NODE_OPTIONS=--experimental-vm-modules). Nunca toca DATABASE_URL.
 */
const d = process.env.RUN_EMBEDDED_PG ? describe : describe.skip;
const MIGRATIONS = resolve(__dirname, '../../prisma/migrations');

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
    s.on('error', rej);
  });
}

d('migrate-runner (Postgres embebido)', () => {
  jest.setTimeout(180_000);
  let dir: string;
  let pg: { stop(): Promise<void> };
  let url: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'automed-pg-'));
    const port = await freePort();
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const inst = new EmbeddedPostgres({
      databaseDir: join(dir, 'data'),
      user: 'postgres',
      password: 'test-pass',
      port,
      persistent: false,
      onLog: () => undefined,
      onError: () => undefined,
    });
    await inst.initialise();
    await inst.start();
    pg = inst;
    url = `postgresql://postgres:test-pass@127.0.0.1:${port}/postgres`;
  });

  afterAll(async () => {
    await pg?.stop().catch(() => undefined);
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const query = async (sql: string, params: unknown[] = []) => {
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
      return await c.query(sql, params);
    } finally {
      await c.end();
    }
  };

  it('aplica todas las migraciones, es idempotente y registra checksums', async () => {
    const all = await listMigrations(MIGRATIONS);
    expect(all.length).toBeGreaterThanOrEqual(12);

    const first = await runMigrations({
      connectionString: url,
      migrationsDir: MIGRATIONS,
    });
    expect(first.applied).toEqual(all.map((m) => m.name));
    expect(first.skipped).toEqual([]);

    const second = await runMigrations({
      connectionString: url,
      migrationsDir: MIGRATIONS,
    });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toHaveLength(all.length);

    const { rows } = await query(
      'SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY migration_name',
    );
    expect(rows).toHaveLength(all.length);
    for (const [i, r] of rows.entries()) {
      expect(r.migration_name).toBe(all[i].name);
      expect(r.checksum).toBe(
        createHash('sha256')
          .update(
            readFileSync(join(MIGRATIONS, r.migration_name, 'migration.sql')),
          )
          .digest('hex'),
      );
      expect(r.finished_at).not.toBeNull();
      expect(r.rolled_back_at).toBeNull();
    }
  });

  it('el esquema resultante permite crear un User', async () => {
    const { rows } = await query(
      `INSERT INTO "User" (id, email, nombre, "passwordHash") VALUES ('u1','a@x.com','Ana','h') RETURNING id`,
    );
    expect(rows[0].id).toBe('u1');
  });

  it('detecta una migración ya aplicada con checksum alterado', async () => {
    const copy = join(dir, 'migraciones-alteradas');
    mkdirSync(copy);
    cpSync(MIGRATIONS, copy, { recursive: true });
    const first = (await listMigrations(copy))[0];
    writeFileSync(
      join(copy, first.name, 'migration.sql'),
      `${first.sql}\n-- x\n`,
    );
    await expect(
      runMigrations({ connectionString: url, migrationsDir: copy }),
    ).rejects.toThrow(/fue modificada/);
  });

  it('aplica también en un esquema propio', async () => {
    const r = await runMigrations({
      connectionString: url,
      migrationsDir: MIGRATIONS,
      schema: 'otro',
    });
    expect(r.applied.length).toBeGreaterThanOrEqual(12);
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM "otro"."_prisma_migrations"`,
    );
    expect(rows[0].n).toBe(r.applied.length);
  });
});
