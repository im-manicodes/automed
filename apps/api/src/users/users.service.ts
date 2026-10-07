import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client';
import { PasswordService } from '../auth/password.service';
import { DEMO_PREFIX } from '../cli/demo-prefix';
import { PrismaService } from '../prisma/prisma.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SETUP_DONE_KEY = 'setup.done';

export type UsersDb = Pick<
  PrismaClient,
  'user' | 'mailAccount' | 'refreshToken' | 'setting'
>;

export interface NewUserInput {
  email: string;
  nombre: string;
  password: string;
}

/** Datos del usuario no válidos (mensaje en español, seguro para mostrar). */
export class UserInputError extends Error {}
/** Ya existe un usuario (la configuración inicial ya se hizo). */
export class SetupConflictError extends Error {}

/**
 * Altas y cambios de usuarios. Lo usan el CLI (`cli/user-admin.ts`, con un PrismaClient propio) y la
 * API (configuración inicial desde la web). Nunca registra contraseñas ni correos en logs.
 */
@Injectable()
export class UsersService {
  /** Serializa la configuración inicial dentro del proceso (además de la transacción y la clave única). */
  private setupLock: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(PrismaService)
    private readonly prisma: UsersDb &
      Partial<Pick<PrismaClient, '$transaction'>>,
    private readonly passwords: PasswordService,
  ) {}

  /** Crea un usuario y adopta la cuenta de Outlook huérfana (anterior a la fase 8), si existe. */
  async createUser(input: NewUserInput, db: UsersDb = this.prisma) {
    const email = (input.email ?? '').trim().toLowerCase();
    const nombre = (input.nombre ?? '').trim();
    if (!EMAIL_RE.test(email))
      throw new UserInputError('El correo no es válido');
    if (!nombre) throw new UserInputError('El nombre no puede estar vacío');
    const policy = this.passwords.policyError(input.password);
    if (policy) throw new UserInputError(policy);
    if (await db.user.findUnique({ where: { email } })) {
      throw new UserInputError(`Ya existe un usuario con el correo ${email}`);
    }
    const user = await db.user.create({
      data: {
        email,
        nombre,
        passwordHash: await this.passwords.hash(input.password),
      },
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

  /** ¿Falta crear el primer usuario? */
  async needsSetup(): Promise<boolean> {
    return (await this.prisma.user.count()) === 0;
  }

  /**
   * Crea el PRIMER usuario de forma atómica: usuario + `Setting 'setup.done'` en una transacción,
   * serializada en el proceso y con bloqueo asesor de Postgres. Si ya hay algún usuario lanza
   * SetupConflictError; dos peticiones simultáneas crean un solo usuario.
   */
  createFirstUser(input: NewUserInput) {
    const run = this.setupLock.then(() => this.createFirstUserTx(input));
    this.setupLock = run.catch(() => undefined);
    return run;
  }

  private async createFirstUserTx(input: NewUserInput) {
    const body = async (tx: UsersDb) => {
      const raw = tx as unknown as {
        $executeRaw?: (q: TemplateStringsArray, ...v: unknown[]) => unknown;
      };
      // Bloqueo asesor (solo en Postgres real) por si hubiera más de una instancia de la API.
      if (typeof raw.$executeRaw === 'function') {
        await raw.$executeRaw`SELECT pg_advisory_xact_lock(7424002)`;
      }
      if ((await tx.user.count()) > 0) throw new SetupConflictError();
      const r = await this.createUser(input, tx);
      await tx.setting.upsert({
        where: { key: SETUP_DONE_KEY },
        create: { key: SETUP_DONE_KEY, value: true },
        update: { value: true },
      });
      return r;
    };
    const p = this.prisma;
    return typeof p.$transaction === 'function'
      ? (
          p.$transaction as (
            fn: (tx: UsersDb) => Promise<unknown>,
          ) => Promise<Awaited<ReturnType<typeof body>>>
        )(body)
      : body(p);
  }
}
