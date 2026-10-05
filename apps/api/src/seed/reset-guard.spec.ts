import {
  checkResetAllowed,
  describeTarget,
  isConfirmationValid,
  parseResetArgs,
} from './reset-guard';

const URL_ =
  'postgresql://usr:Sup3rSecreta@db.ejemplo.com:6543/miBase?schema=otro';
const target = describeTarget(URL_);

describe('reset-guard', () => {
  it('describe el destino sin usuario ni contraseña', () => {
    expect(target).toEqual({
      host: 'db.ejemplo.com',
      port: '6543',
      database: 'miBase',
      schema: 'otro',
    });
    expect(JSON.stringify(target)).not.toContain('Sup3rSecreta');
    expect(JSON.stringify(target)).not.toContain('usr');
  });

  it('usa puerto 5432 y esquema public por defecto', () => {
    expect(describeTarget('postgresql://u:p@h/b')).toMatchObject({
      port: '5432',
      schema: 'public',
    });
  });

  it('rechaza una URL inválida sin filtrar su contenido', () => {
    expect(() => describeTarget('no-es-url-con-clave')).toThrow(
      'DATABASE_URL no es una URL válida',
    );
  });

  it('se niega en producción, incluso con --force --i-understand', () => {
    const args = { force: true, iUnderstand: true };
    const r = checkResetAllowed('production', target, args);
    expect(r.ok).toBe(false);
    expect(
      checkResetAllowed('production', target, {
        force: false,
        iUnderstand: false,
      }).ok,
    ).toBe(false);
  });

  it('sin --force exige confirmación escrita', () => {
    expect(
      checkResetAllowed('development', target, {
        force: false,
        iUnderstand: false,
      }),
    ).toEqual({ ok: true, needsTypedConfirmation: true });
  });

  it('--force exige --i-understand y viceversa', () => {
    expect(
      checkResetAllowed(undefined, target, { force: true, iUnderstand: false })
        .ok,
    ).toBe(false);
    expect(
      checkResetAllowed(undefined, target, { force: false, iUnderstand: true })
        .ok,
    ).toBe(false);
    expect(
      checkResetAllowed(undefined, target, { force: true, iUnderstand: true }),
    ).toEqual({ ok: true, needsTypedConfirmation: false });
  });

  it('--force nunca se permite sobre el esquema public', () => {
    const pub = describeTarget('postgresql://u:p@h:5432/b');
    const r = checkResetAllowed(undefined, pub, {
      force: true,
      iUnderstand: true,
    });
    expect(r.ok).toBe(false);
  });

  it('la confirmación debe ser el nombre exacto de la base', () => {
    expect(isConfirmationValid('miBase', target)).toBe(true);
    expect(isConfirmationValid('mibase', target)).toBe(false);
    expect(isConfirmationValid('miBase ', target)).toBe(false);
    expect(isConfirmationValid('', target)).toBe(false);
    expect(isConfirmationValid('y', target)).toBe(false);
  });

  it('parseResetArgs entiende los flags y rechaza desconocidos', () => {
    expect(parseResetArgs(['--', '--force', '--i-understand'])).toEqual({
      force: true,
      iUnderstand: true,
    });
    expect(() => parseResetArgs(['--yes'])).toThrow('no reconocido');
  });
});
