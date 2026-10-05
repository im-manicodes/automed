/** Lógica pura (sin E/S) de las protecciones de `db:reset`. */

export interface ResetTarget {
  host: string;
  port: string;
  database: string;
  schema: string;
}

/** Extrae servidor, puerto, base y esquema de la URL; NUNCA incluye usuario ni contraseña. */
export function describeTarget(databaseUrl: string): ResetTarget {
  let u: URL;
  try {
    u = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL no es una URL válida');
  }
  return {
    host: u.hostname,
    port: u.port || '5432',
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    schema: u.searchParams.get('schema') || 'public',
  };
}

export interface ResetArgs {
  force: boolean;
  iUnderstand: boolean;
}

export function parseResetArgs(argv: string[]): ResetArgs {
  const out: ResetArgs = { force: false, iUnderstand: false };
  for (const a of argv) {
    if (a === '--') continue;
    if (a === '--force') out.force = true;
    else if (a === '--i-understand') out.iUnderstand = true;
    else throw new Error(`Argumento no reconocido: ${a}`);
  }
  return out;
}

export type ResetDecision =
  { ok: true; needsTypedConfirmation: boolean } | { ok: false; reason: string };

/** Decide si el reset puede continuar (antes de pedir la confirmación escrita). */
export function checkResetAllowed(
  nodeEnv: string | undefined,
  target: ResetTarget,
  args: ResetArgs,
): ResetDecision {
  if (nodeEnv === 'production') {
    return {
      ok: false,
      reason: 'NODE_ENV=production: db:reset está prohibido en producción.',
    };
  }
  if (args.iUnderstand && !args.force) {
    return {
      ok: false,
      reason: '--i-understand solo se usa junto con --force.',
    };
  }
  if (args.force) {
    if (!args.iUnderstand) {
      return { ok: false, reason: '--force exige también --i-understand.' };
    }
    if (target.schema === 'public') {
      return {
        ok: false,
        reason:
          '--force no se permite sobre el esquema "public": usa la confirmación escrita.',
      };
    }
    return { ok: true, needsTypedConfirmation: false };
  }
  return { ok: true, needsTypedConfirmation: true };
}

/** La confirmación es válida solo si es EXACTAMENTE el nombre de la base. */
export function isConfirmationValid(typed: string, target: ResetTarget) {
  return target.database.length > 0 && typed === target.database;
}
