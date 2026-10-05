/**
 * Seed base (idempotente): plantilla activa, ajustes y, opcional y solo en desarrollo, un usuario.
 *   pnpm db:seed        (desde la raíz)   ·   también lo invoca `prisma db seed` / `migrate reset`
 * Variables opcionales: SEED_USER_EMAIL, SEED_USER_NAME, SEED_USER_PASSWORD (nunca se imprimen).
 */
import { loadRootEnv } from '../src/cli/load-env';
import { createPgAdapter } from '../src/prisma/prisma.service';
import { PrismaClient } from '../src/generated/prisma/client';
import { PasswordService } from '../src/auth/password.service';
import { createUser } from '../src/cli/user-admin';
import {
  DEFAULT_TEMPLATE_MARKDOWN,
  DEFAULT_TEMPLATE_NAME,
} from '../src/templates/default-template';

export type SeedDb = Pick<
  PrismaClient,
  'user' | 'mailAccount' | 'refreshToken' | 'template' | 'setting'
>;

export type SeedEnv = Record<string, string | undefined>;

/** Ajustes por defecto: solo se crean si la clave no existe (nunca pisan lo que el usuario cambió). */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  'app.idioma': 'es',
  'analisis.modo': 'bajo_peticion',
};

export interface SeedReport {
  template: 'creada' | 'omitida';
  settingsCreados: string[];
  settingsOmitidos: string[];
  user: 'creado' | 'omitido' | 'no_configurado' | 'rechazado_produccion';
}

/** Crea la plantilla activa por defecto si no hay ninguna activa (misma versión inicial que TemplatesService). */
export async function ensureActiveTemplate(
  db: Pick<SeedDb, 'template'>,
): Promise<{ created: boolean }> {
  const active = await db.template.findFirst({ where: { isActive: true } });
  if (active) return { created: false };
  const last = await db.template.findFirst({
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  await db.template.create({
    data: {
      name: DEFAULT_TEMPLATE_NAME,
      markdown: DEFAULT_TEMPLATE_MARKDOWN,
      version: (last?.version ?? 0) + 1,
      isActive: true,
    },
  });
  return { created: true };
}

/** Seed base, idempotente: plantilla, ajustes y (opcional, solo desarrollo) usuario SEED_USER_*. */
export async function seedBase(
  db: SeedDb,
  passwords: PasswordService,
  env: SeedEnv,
  log: (msg: string) => void,
): Promise<SeedReport> {
  const report: SeedReport = {
    template: 'omitida',
    settingsCreados: [],
    settingsOmitidos: [],
    user: 'no_configurado',
  };

  const tpl = await ensureActiveTemplate(db);
  report.template = tpl.created ? 'creada' : 'omitida';
  log(
    tpl.created
      ? 'Plantilla: creada la plantilla activa por defecto.'
      : 'Plantilla: ya hay una plantilla activa; se omite.',
  );

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (await db.setting.findUnique({ where: { key } })) {
      report.settingsOmitidos.push(key);
    } else {
      await db.setting.create({ data: { key, value: value as never } });
      report.settingsCreados.push(key);
    }
  }
  log(
    `Ajustes: ${report.settingsCreados.length} creados, ${report.settingsOmitidos.length} ya existían.`,
  );

  const email = env.SEED_USER_EMAIL?.trim();
  const nombre = env.SEED_USER_NAME?.trim();
  const password = env.SEED_USER_PASSWORD;
  const provided = [email, nombre, password].filter((v) => !!v).length;
  if (provided === 0) {
    log(
      'Usuario: omitido (SEED_USER_EMAIL, SEED_USER_NAME y SEED_USER_PASSWORD no están definidas).',
    );
    return report;
  }
  if (provided < 3) {
    log(
      'Usuario: omitido, faltan variables (se necesitan SEED_USER_EMAIL, SEED_USER_NAME y SEED_USER_PASSWORD a la vez).',
    );
    return report;
  }
  if (env.NODE_ENV === 'production') {
    report.user = 'rechazado_produccion';
    log(
      'Usuario: RECHAZADO, NODE_ENV=production. El usuario de desarrollo solo se crea en desarrollo; usa "user:create".',
    );
    return report;
  }
  const normalized = email!.toLowerCase();
  if (await db.user.findUnique({ where: { email: normalized } })) {
    report.user = 'omitido';
    log(`Usuario: ${normalized} ya existe; no se modifica (ni su contraseña).`);
    return report;
  }
  const { user, adoptedMailbox } = await createUser(db, passwords, {
    email: email!,
    nombre: nombre!,
    password: password!,
  });
  report.user = 'creado';
  log(`Usuario: creado ${user.email} (usuario de DESARROLLO).`);
  if (adoptedMailbox) {
    log(
      `AVISO: se asignó a este usuario la cuenta de Outlook ya existente (${adoptedMailbox}), igual que hace "user:create".`,
    );
  }
  return report;
}

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

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(`Error: ${e instanceof Error ? e.message : 'desconocido'}`);
    process.exit(1);
  });
}
