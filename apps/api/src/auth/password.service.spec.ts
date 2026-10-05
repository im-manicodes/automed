import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const p = new PasswordService();

  it('usa argon2id y verifica', async () => {
    const h = await p.hash('una-contraseña-larga');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await p.verify(h, 'una-contraseña-larga')).toBe(true);
    expect(await p.verify(h, 'otra')).toBe(false);
    expect(await p.verify('no-es-un-hash', 'x')).toBe(false);
  });

  it('hash dummy siempre es false y no lanza', async () => {
    expect(await p.verifyDummy('cualquiera')).toBe(false);
  });

  it('política mínima de 10 caracteres', () => {
    expect(p.policyError('123456789')).toMatch(/al menos 10/);
    expect(p.policyError('1234567890')).toBeNull();
  });
});
