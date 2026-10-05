import { fakePrisma } from '../../test/helpers/fake-prisma';
import { PasswordService } from '../auth/password.service';
import { createUser, resetPassword } from './user-admin';

const setup = () => {
  const db = fakePrisma();
  return { db, pw: new PasswordService() };
};

const asDb = (d: unknown) => d as any;

describe('user-admin (CLI)', () => {
  it('crea usuario en minúsculas y adopta la MailAccount huérfana', async () => {
    const { db, pw } = setup();
    await db.mailAccount.create({
      data: { email: 'o@x.com', tokenEnc: 'enc' },
    });
    const r = await createUser(asDb(db), pw, {
      email: 'Ana@X.com',
      nombre: 'Ana',
      password: 'contraseña-larga-1',
    });
    expect(r.user.email).toBe('ana@x.com');
    expect(r.adoptedMailbox).toBe('o@x.com');
    expect(db.mailAccount.rows[0].userId).toBe(r.user.id);
    expect(db.user.rows[0].passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('error claro si existe, correo inválido o contraseña corta', async () => {
    const { db, pw } = setup();
    const base = {
      email: 'a@x.com',
      nombre: 'A',
      password: 'contraseña-larga-1',
    };
    await createUser(asDb(db), pw, base);
    await expect(createUser(asDb(db), pw, base)).rejects.toThrow('Ya existe');
    await expect(
      createUser(asDb(db), pw, { ...base, email: 'x' }),
    ).rejects.toThrow('correo');
    await expect(
      createUser(asDb(db), pw, {
        ...base,
        email: 'b@x.com',
        password: 'corta',
      }),
    ).rejects.toThrow('al menos 10');
  });

  it('reset-password cambia el hash y revoca sesiones', async () => {
    const { db, pw } = setup();
    const { user } = await createUser(asDb(db), pw, {
      email: 'a@x.com',
      nombre: 'A',
      password: 'contraseña-larga-1',
    });
    await db.refreshToken.create({ data: { userId: user.id, tokenHash: 'h' } });
    await resetPassword(asDb(db), pw, {
      email: 'a@x.com',
      password: 'otra-contraseña-2',
    });
    expect(
      await pw.verify(db.user.rows[0].passwordHash, 'otra-contraseña-2'),
    ).toBe(true);
    expect(db.refreshToken.rows[0].revokedAt).toBeInstanceOf(Date);
    await expect(
      resetPassword(asDb(db), pw, {
        email: 'no@x.com',
        password: 'otra-contraseña-2',
      }),
    ).rejects.toThrow('No existe');
  });
});
