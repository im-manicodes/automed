/**
 * Migrador propio (modo escritorio): aplica `prisma/migrations/<nombre>/migration.sql` en orden
 * alfabético y lo registra en `_prisma_migrations` con el MISMO esquema que crea Prisma, de modo
 * que una BD migrada con `prisma migrate deploy` es compatible (y al revés). Así el instalable no
 * necesita la CLI ni el schema-engine de Prisma. Docker/Dokku siguen con `prisma migrate deploy`.
 *
 * Cada archivo se envía como UNA consulta con el protocolo simple (igual que Prisma), por lo que
 * Postgres lo ejecuta en una transacción implícita: si falla, no queda nada a medias y no se
 * registra. Nunca se registra contenido de las migraciones ni la cadena de conexión.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

export interface RunMigrationsOptions {
  connectionString: string;
  migrationsDir: string;
  /** Esquema de destino (se crea si no existe). Por defecto, el de la conexión (`public`). */
  schema?: string;
}

export interface RunMigrationsResult {
  applied: string[];
  skipped: string[];
}

export class MigrationError extends Error {}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
const sha256 = (v: Buffer | string) =>
  createHash('sha256').update(v).digest('hex');

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS _prisma_migrations (
  id VARCHAR(36) PRIMARY KEY NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  finished_at TIMESTAMPTZ,
  migration_name VARCHAR(255) NOT NULL,
  logs TEXT,
  rolled_back_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_steps_count INTEGER NOT NULL DEFAULT 0
)`;

/** Lista las carpetas de migración (con migration.sql) ordenadas por nombre. */
export async function listMigrations(migrationsDir: string) {
  let entries;
  try {
    entries = await readdir(migrationsDir, { withFileTypes: true });
  } catch {
    throw new MigrationError(
      `No se encontró la carpeta de migraciones: ${migrationsDir}`,
    );
  }
  const names = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const out: { name: string; sql: string; checksum: string }[] = [];
  for (const name of names) {
    let buf: Buffer;
    try {
      buf = await readFile(join(migrationsDir, name, 'migration.sql'));
    } catch {
      continue; // carpeta sin migration.sql: se ignora (como Prisma)
    }
    out.push({ name, sql: buf.toString('utf8'), checksum: sha256(buf) });
  }
  return out;
}

export async function runMigrations(
  opts: RunMigrationsOptions,
): Promise<RunMigrationsResult> {
  const migrations = await listMigrations(opts.migrationsDir);
  const client = new Client({ connectionString: opts.connectionString });
  await client.connect();
  const result: RunMigrationsResult = { applied: [], skipped: [] };
  const lockKey = 7_424_001; // evita dos migradores simultáneos
  try {
    if (opts.schema) {
      const s = quoteIdent(opts.schema);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${s}`);
      await client.query(`SET search_path TO ${s}`);
    }
    await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
    await client.query(CREATE_TABLE);

    const { rows } = await client.query<{
      migration_name: string;
      checksum: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>(
      `SELECT migration_name, checksum, finished_at, rolled_back_at
         FROM _prisma_migrations ORDER BY started_at`,
    );
    const done = new Map<string, string>();
    for (const r of rows) {
      if (r.rolled_back_at) continue;
      if (!r.finished_at) {
        throw new MigrationError(
          `La migración ${r.migration_name} quedó a medias en un intento anterior; resuélvela con "prisma migrate resolve" antes de continuar.`,
        );
      }
      done.set(r.migration_name, r.checksum);
    }

    for (const m of migrations) {
      const prev = done.get(m.name);
      if (prev !== undefined) {
        if (prev !== m.checksum) {
          throw new MigrationError(
            `La migración ya aplicada ${m.name} fue modificada (el checksum no coincide). No se modifican migraciones aplicadas.`,
          );
        }
        result.skipped.push(m.name);
        continue;
      }
      const startedAt = new Date();
      try {
        await client.query(m.sql); // protocolo simple: una sola consulta
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'error desconocido';
        throw new MigrationError(`Falló la migración ${m.name}: ${msg}`);
      }
      await client.query(
        `INSERT INTO _prisma_migrations
           (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, NULL, $4, 1)`,
        [randomUUID(), m.checksum, m.name, startedAt],
      );
      result.applied.push(m.name);
    }
    return result;
  } finally {
    await client.end().catch(() => undefined);
  }
}
