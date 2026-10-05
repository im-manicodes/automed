import type { PrismaClient } from '../generated/prisma/client';
import type { PasswordService } from '../auth/password.service';
import { DEMO_PREFIX } from './demo-prefix';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Db = Pick<PrismaClient, 'user' | 'mailAccount' | 'refreshToken'>;

/** Crea un usuario y adopta la cuenta de Outlook huérfana (anterior a la fase 8), si existe. */
export async function createUser(
  db: Db,
  passwords: PasswordService,
  input: { email: string; nombre: string; password: string },
) {
  const email = input.email.trim().toLowerCase();
  const nombre = input.nombre.trim();
  if (!EMAIL_RE.test(email)) throw new Error('El correo no es válido');
  if (!nombre) throw new Error('El nombre no puede estar vacío');
  const policy = passwords.policyError(input.password);
  if (policy) throw new Error(policy);
  if (await db.user.findUnique({ where: { email } })) {
    throw new Error(`Ya existe un usuario con el correo ${email}`);
  }
  const user = await db.user.create({
    data: { email, nombre, passwordHash: await passwords.hash(input.password) },
  });
  // Nunca se adopta la cuenta ficticia del seed demo (ids con prefijo demo-).
  const orphan = await db.mailAccount.findFirst({
    where: { userId: null, NOT: { id: { startsWith: DEMO_PREFIX } } },
  });
  let adopted: string | null = null;
  if (orphan) {
    await db.mailAccount.update({
      where: { id: orphan.id },
      data: { userId: user.id },
    });
    adopted = orphan.email;
  }
  return { user, adoptedMailbox: adopted };
}

/** Cambia la contraseña y revoca todas las sesiones (refresh tokens) del usuario. */
export async function resetPassword(
  db: Db,
  passwords: PasswordService,
  input: { email: string; password: string },
) {
  const email = input.email.trim().toLowerCase();
  const policy = passwords.policyError(input.password);
  if (policy) throw new Error(policy);
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No existe un usuario con el correo ${email}`);
  const now = new Date();
  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await passwords.hash(input.password),
      passwordChangedAt: now,
    },
  });
  await db.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: now },
  });
  return user;
}
