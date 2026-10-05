import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { fakePrisma } from '../../test/helpers/fake-prisma';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import type { PrismaService } from '../prisma/prisma.service';

const SECRET = 'x'.repeat(40);

function setup(env: Record<string, string> = {}) {
  const db = fakePrisma();
  const passwords = new PasswordService();
  const jwt = new JwtService({ secret: SECRET });
  const config = {
    get: (k: string) => env[k],
  } as unknown as ConfigService;
  const svc = new AuthService(
    config,
    db as unknown as PrismaService,
    passwords,
    jwt,
  );
  return { db, passwords, jwt, svc };
}

async function withUser() {
  const ctx = setup();
  await ctx.db.user.create({
    data: {
      email: 'ana@x.com',
      nombre: 'Ana',
      passwordHash: await ctx.passwords.hash('contraseña-larga-1'),
    },
  });
  return ctx;
}

describe('AuthService', () => {
  it('login correcto emite access + refresh y guarda solo el hash', async () => {
    const { svc, db } = await withUser();
    const t = await svc.login(' ANA@x.com ', 'contraseña-larga-1', 'jest');
    expect(t.user).toMatchObject({ email: 'ana@x.com', nombre: 'Ana' });
    expect(svc.verifyAccess(t.access)?.email).toBe('ana@x.com');
    expect(db.refreshToken.rows).toHaveLength(1);
    expect(db.refreshToken.rows[0].tokenHash).not.toContain(t.refresh);
    expect(db.refreshToken.rows[0].tokenHash).toHaveLength(64);
  });

  it('login incorrecto: mismo mensaje con usuario inexistente o contraseña mala', async () => {
    const { svc } = await withUser();
    const msgs: string[] = [];
    for (const [e, p] of [
      ['ana@x.com', 'mala-mala-mala'],
      ['nadie@x.com', 'mala-mala-mala'],
      [undefined, 5],
    ]) {
      await svc.login(e, p).catch((err: Error) => msgs.push(err.message));
    }
    expect(msgs).toEqual(Array(3).fill('Correo o contraseña incorrectos'));
  });

  it('usuario inexistente verifica contra el hash falso (anti-enumeración)', async () => {
    const { svc, passwords } = await withUser();
    const dummy = jest.spyOn(passwords, 'verifyDummy');
    const real = jest.spyOn(passwords, 'verify');
    await svc.login('nadie@x.com', 'loquesea-123').catch(() => undefined);
    expect(dummy).toHaveBeenCalledTimes(1);
    expect(real).toHaveBeenCalledTimes(1); // dentro de verifyDummy
    expect(await passwords.verifyDummy('x')).toBe(false);
  });

  it('refresh rota el token; reutilizar el viejo revoca la familia', async () => {
    const { svc, db } = await withUser();
    const t1 = await svc.login('ana@x.com', 'contraseña-larga-1');
    const t2 = await svc.refresh(t1.refresh);
    expect(t2.refresh).not.toBe(t1.refresh);
    expect(db.refreshToken.rows[0].replacedBy).toBe(db.refreshToken.rows[1].id);
    await expect(svc.refresh(t1.refresh)).rejects.toThrow('Sesión no válida');
    // la familia entera quedó revocada: ni el token nuevo sirve
    await expect(svc.refresh(t2.refresh)).rejects.toThrow('Sesión no válida');
    expect(db.refreshToken.rows.every((r) => r.revokedAt)).toBe(true);
  });

  it('refresh expirado, inexistente o ausente -> 401', async () => {
    const { svc, db } = await withUser();
    const t = await svc.login('ana@x.com', 'contraseña-larga-1');
    db.refreshToken.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.refresh(t.refresh)).rejects.toThrow();
    await expect(svc.refresh('inventado')).rejects.toThrow();
    await expect(svc.refresh(undefined)).rejects.toThrow();
  });

  it('logout revoca la familia', async () => {
    const { svc } = await withUser();
    const t = await svc.login('ana@x.com', 'contraseña-larga-1');
    await svc.logout(t.refresh);
    await expect(svc.refresh(t.refresh)).rejects.toThrow();
  });

  it('verifyAccess rechaza token alterado, de otra clave, expirado o de otra audiencia', async () => {
    const { svc, jwt } = await withUser();
    const t = await svc.login('ana@x.com', 'contraseña-larga-1');
    expect(svc.verifyAccess(t.access + 'x')).toBeNull();
    expect(svc.verifyAccess(undefined)).toBeNull();
    const other = new JwtService({ secret: 'y'.repeat(40) });
    const opts = { subject: 'u', audience: 'access' };
    expect(svc.verifyAccess(other.sign({ email: 'a@b.c' }, opts))).toBeNull();
    expect(
      svc.verifyAccess(
        jwt.sign({ email: 'a@b.c' }, { ...opts, expiresIn: -10 }),
      ),
    ).toBeNull();
    expect(
      svc.verifyAccess(
        jwt.sign({ email: 'a@b.c' }, { subject: 'u', audience: 'ms-state' }),
      ),
    ).toBeNull();
  });

  it('change-password valida actual y política, y revoca las otras sesiones', async () => {
    const { svc, db } = await withUser();
    const user = db.user.rows[0];
    const a = await svc.login('ana@x.com', 'contraseña-larga-1');
    const b = await svc.login('ana@x.com', 'contraseña-larga-1');
    await expect(
      svc.changePassword(
        user.id,
        'incorrecta-123',
        'nueva-contraseña-1',
        a.refresh,
      ),
    ).rejects.toThrow('contraseña actual');
    await expect(
      svc.changePassword(user.id, 'contraseña-larga-1', 'corta', a.refresh),
    ).rejects.toThrow('al menos 10');
    await svc.changePassword(
      user.id,
      'contraseña-larga-1',
      'nueva-contraseña-1',
      a.refresh,
    );
    await expect(svc.refresh(b.refresh)).rejects.toThrow(); // otra sesión revocada
    await expect(svc.refresh(a.refresh)).resolves.toBeDefined(); // la actual sigue
    await expect(
      svc.login('ana@x.com', 'contraseña-larga-1'),
    ).rejects.toThrow();
    await expect(
      svc.login('ana@x.com', 'nueva-contraseña-1'),
    ).resolves.toBeDefined();
  });

  it('TTL configurables', () => {
    const { svc } = setup({ JWT_ACCESS_TTL: '5m', JWT_REFRESH_TTL: '2d' });
    expect(svc.accessTtlMs()).toBe(300_000);
    expect(svc.refreshTtlMs()).toBe(2 * 86_400_000);
  });
});
