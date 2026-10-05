/**
 * CLI de usuarios (la contraseña SIEMPRE se pide por prompt sin eco; nunca por argumentos).
 *   pnpm --filter api user:create -- --email <correo> --nombre <nombre>
 *   pnpm --filter api user:reset-password -- --email <correo>
 * En producción (imagen Docker): docker compose exec api node dist/cli/user.js create --email ... --nombre ...
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createPgAdapter } from '../prisma/prisma.service';
import { PrismaClient } from '../generated/prisma/client';
import { PasswordService } from '../auth/password.service';
import { createUser, resetPassword } from './user-admin';

config({ path: resolve(__dirname, '../../../../.env'), quiet: true });
config({ path: resolve(process.cwd(), '.env'), quiet: true });

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (!a.startsWith('--')) throw new Error(`Argumento no reconocido: ${a}`);
    const key = a.slice(2);
    if (key === 'password') {
      throw new Error(
        'La contraseña no se acepta por argumentos: se pide por prompt',
      );
    }
    const val = argv[++i];
    if (val === undefined || val.startsWith('--')) {
      throw new Error(`Falta el valor de --${key}`);
    }
    out[key] = val;
  }
  return out;
}

/** Lee una línea de la terminal sin mostrar lo que se escribe. */
function promptHidden(label: string): Promise<string> {
  return new Promise((resolveP, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(
        new Error(
          'Se requiere una terminal interactiva (usa docker compose exec sin -T)',
        ),
      );
      return;
    }
    process.stdout.write(label);
    let buf = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolveP(buf);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function askNewPassword(passwords: PasswordService) {
  const p1 = await promptHidden('Contraseña (mín. 10 caracteres): ');
  const policy = passwords.policyError(p1);
  if (policy) throw new Error(policy);
  const p2 = await promptHidden('Repite la contraseña: ');
  if (p1 !== p2) throw new Error('Las contraseñas no coinciden');
  return p1;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!['create', 'reset-password'].includes(cmd ?? '')) {
    throw new Error(
      'Uso: user.js create --email <correo> --nombre <nombre> | reset-password --email <correo>',
    );
  }
  if (!args.email) throw new Error('Falta --email');
  if (cmd === 'create' && !args.nombre) throw new Error('Falta --nombre');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (.env raíz)');

  const passwords = new PasswordService();
  const password = await askNewPassword(passwords);
  const prisma = new PrismaClient({ adapter: createPgAdapter(url) });
  try {
    if (cmd === 'create') {
      const { user, adoptedMailbox } = await createUser(prisma, passwords, {
        email: args.email,
        nombre: args.nombre,
        password,
      });
      console.log(`Usuario creado: ${user.email}`);
      if (adoptedMailbox) {
        console.log(
          `Se asignó a este usuario la cuenta de Outlook existente (${adoptedMailbox}).`,
        );
      }
    } else {
      const user = await resetPassword(prisma, passwords, {
        email: args.email,
        password,
      });
      console.log(
        `Contraseña actualizada para ${user.email}; se cerraron sus sesiones.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`Error: ${e instanceof Error ? e.message : 'desconocido'}`);
  process.exit(1);
});
