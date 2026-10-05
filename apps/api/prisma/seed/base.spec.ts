import { fakePrisma } from '../../test/helpers/fake-prisma';
import { PasswordService } from '../../src/auth/password.service';
import { DEFAULT_TEMPLATE_MARKDOWN } from '../../src/templates/default-template';
import { DEFAULT_SETTINGS, seedBase } from './base';

const asDb = (d: unknown) => d as any;
const PW = 'contraseña-secreta-123';
const USER_ENV = {
  SEED_USER_EMAIL: 'Dev@Ejemplo.com',
  SEED_USER_NAME: 'Dev',
  SEED_USER_PASSWORD: PW,
};

function run(
  db: ReturnType<typeof fakePrisma>,
  env: Record<string, string | undefined>,
) {
  const out: string[] = [];
  const p = seedBase(asDb(db), new PasswordService(), env, (m) => out.push(m));
  return p.then((report) => ({ report, out }));
}

describe('seedBase', () => {
  it('crea plantilla por defecto y ajustes; segunda corrida no duplica', async () => {
    const db = fakePrisma();
    const a = await run(db, {});
    expect(a.report.template).toBe('creada');
    expect(db.template.rows).toHaveLength(1);
    expect(db.template.rows[0].markdown).toBe(DEFAULT_TEMPLATE_MARKDOWN);
    expect(db.setting.rows).toHaveLength(Object.keys(DEFAULT_SETTINGS).length);

    const b = await run(db, {});
    expect(b.report.template).toBe('omitida');
    expect(b.report.settingsCreados).toEqual([]);
    expect(db.template.rows).toHaveLength(1);
    expect(db.setting.rows).toHaveLength(Object.keys(DEFAULT_SETTINGS).length);
  });

  it('no pisa una plantilla activa ni un ajuste cambiados por el usuario', async () => {
    const db = fakePrisma();
    await db.template.create({
      data: { name: 'Mía', markdown: '# Mía', version: 4 },
    });
    await db.setting.create({ data: { key: 'app.idioma', value: 'en' } });
    await run(db, {});
    expect(db.template.rows).toHaveLength(1);
    expect(db.template.rows[0].name).toBe('Mía');
    expect(db.setting.rows.find((s) => s.key === 'app.idioma')?.value).toBe(
      'en',
    );
  });

  it('sin variables SEED_* no crea usuario', async () => {
    const db = fakePrisma();
    const { report } = await run(db, {});
    expect(report.user).toBe('no_configurado');
    expect(db.user.rows).toHaveLength(0);
  });

  it('con variables incompletas omite el usuario y lo avisa', async () => {
    const db = fakePrisma();
    const { report, out } = await run(db, { SEED_USER_EMAIL: 'a@b.co' });
    expect(report.user).toBe('no_configurado');
    expect(out.join('\n')).toContain('faltan variables');
  });

  it('crea el usuario (argon2id), es idempotente y no lo modifica', async () => {
    const db = fakePrisma();
    const a = await run(db, USER_ENV);
    expect(a.report.user).toBe('creado');
    expect(db.user.rows).toHaveLength(1);
    expect(db.user.rows[0].email).toBe('dev@ejemplo.com');
    expect(db.user.rows[0].passwordHash.startsWith('$argon2id$')).toBe(true);
    const hash = db.user.rows[0].passwordHash;

    const b = await run(db, {
      ...USER_ENV,
      SEED_USER_PASSWORD: 'otra-contraseña-larga',
    });
    expect(b.report.user).toBe('omitido');
    expect(db.user.rows).toHaveLength(1);
    expect(db.user.rows[0].passwordHash).toBe(hash);
  });

  it('adopta la MailAccount huérfana (como user:create) y lo avisa, pero nunca la demo', async () => {
    const db = fakePrisma();
    await db.mailAccount.create({
      data: { id: 'demo-cuenta', email: 'demo@demo.invalid' },
    });
    await db.mailAccount.create({
      data: { email: 'real@x.com', tokenEnc: 'enc' },
    });
    const { out } = await run(db, USER_ENV);
    const demo = db.mailAccount.rows.find((a) => a.id === 'demo-cuenta')!;
    const real = db.mailAccount.rows.find((a) => a.email === 'real@x.com')!;
    expect(demo.userId).toBeNull();
    expect(real.userId).toBe(db.user.rows[0].id);
    expect(out.join('\n')).toContain('AVISO');
    expect(out.join('\n')).toContain('real@x.com');
  });

  it('en producción rechaza crear el usuario pero siembra plantilla y ajustes', async () => {
    const db = fakePrisma();
    const { report } = await run(db, { ...USER_ENV, NODE_ENV: 'production' });
    expect(report.user).toBe('rechazado_produccion');
    expect(db.user.rows).toHaveLength(0);
    expect(db.template.rows).toHaveLength(1);
  });

  it('no imprime contraseñas ni hashes', async () => {
    const db = fakePrisma();
    const first = await run(db, USER_ENV);
    const second = await run(db, USER_ENV);
    const text = [...first.out, ...second.out].join('\n');
    expect(text).not.toContain(PW);
    expect(text).not.toContain('$argon2');
    expect(text).not.toContain(db.user.rows[0].passwordHash);
  });

  it('una contraseña corta falla con error que no contiene la contraseña', async () => {
    const db = fakePrisma();
    const err = await run(db, {
      ...USER_ENV,
      SEED_USER_PASSWORD: 'corta',
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('corta');
    expect(db.user.rows).toHaveLength(0);
  });
});
