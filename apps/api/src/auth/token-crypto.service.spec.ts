import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { TokenCryptoService } from './token-crypto.service';

const make = (key?: string) =>
  new TokenCryptoService({ get: () => key } as unknown as ConfigService);

describe('TokenCryptoService', () => {
  const key = randomBytes(32).toString('base64');

  it('cifra y descifra (ida y vuelta)', () => {
    const c = make(key);
    const enc = c.encrypt('refresh-token-secreto');
    expect(enc).not.toContain('refresh-token-secreto');
    expect(c.decrypt(enc)).toBe('refresh-token-secreto');
  });

  it('usa IV aleatorio', () => {
    const c = make(key);
    expect(c.encrypt('x')).not.toBe(c.encrypt('x'));
  });

  it('detecta manipulación y clave incorrecta', () => {
    const enc = make(key).encrypt('hola');
    const parts = enc.split('.');
    parts[3] = Buffer.from('zzzz').toString('base64url');
    expect(() => make(key).decrypt(parts.join('.'))).toThrow();
    expect(() =>
      make(randomBytes(32).toString('base64')).decrypt(enc),
    ).toThrow();
  });

  it('exige clave de 32 bytes', () => {
    expect(() => make('corta').encrypt('x')).toThrow(/TOKEN_ENC_KEY/);
    expect(() => make(undefined).encrypt('x')).toThrow(/TOKEN_ENC_KEY/);
  });
});
