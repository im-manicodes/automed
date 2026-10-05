import type { ConfigService } from '@nestjs/config';
import { jwtSecretFrom } from './auth.module';

const cfg = (v?: string) => ({ get: () => v }) as unknown as ConfigService;

describe('JWT_SECRET obligatorio', () => {
  it('falla con mensaje claro si falta o es corto', () => {
    expect(() => jwtSecretFrom(cfg())).toThrow(
      /JWT_SECRET falta o es demasiado corto/,
    );
    expect(() => jwtSecretFrom(cfg('corto'))).toThrow(/mínimo 32/);
  });
  it('acepta un secreto suficientemente largo', () => {
    expect(jwtSecretFrom(cfg('x'.repeat(32)))).toHaveLength(32);
  });
});
