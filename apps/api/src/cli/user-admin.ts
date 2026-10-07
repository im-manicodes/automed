import type { PrismaClient } from '../generated/prisma/client';
import type { PasswordService } from '../auth/password.service';
import { UsersService } from '../users/users.service';

type Db = Pick<
  PrismaClient,
  'user' | 'mailAccount' | 'refreshToken' | 'setting'
>;

/** Crea un usuario y adopta la cuenta de Outlook huérfana, si existe (lógica en UsersService). */
export function createUser(
  db: Db,
  passwords: PasswordService,
  input: { email: string; nombre: string; password: string },
) {
  return new UsersService(db, passwords).createUser(input);
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
