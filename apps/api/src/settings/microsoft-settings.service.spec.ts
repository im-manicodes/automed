import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { TokenCryptoService } from '../auth/token-crypto.service';
import { MicrosoftSettingsService } from './microsoft-settings.service';

const KEY = randomBytes(32).toString('base64');
const GUID = '11111111-2222-3333-4444-555555555555';

function setup(env: Record<string, string> = {}) {
  const rows = new Map<string, unknown>();
  const prisma: any = {
    setting: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          rows.has(where.key)
            ? { key: where.key, value: rows.get(where.key) }
            : null,
        ),
      ),
      upsert: jest.fn(({ where, create }: any) => {
        rows.set(where.key, create.value);
        return Promise.resolve({});
      }),
    },
  };
  const all = { TOKEN_ENC_KEY: KEY, ...env } as Record<string, string>;
  const config: any = { get: (k: string) => all[k] };
  const crypto = new TokenCryptoService(config);
  return {
    svc: new MicrosoftSettingsService(prisma, config, crypto),
    rows,
  };
}

describe('MicrosoftSettingsService', () => {
  it('sin nada: no configurado, inquilino common y URL sugerida desde WEB_ORIGIN', async () => {
    const { svc } = setup({ WEB_ORIGIN: 'https://app.test/' });
    const p = await svc.getPublic();
    expect(p).toMatchObject({
      configurado: false,
      tenantId: 'common',
      tieneSecreto: false,
      redirectUriSugerida: 'https://app.test/api/auth/callback',
      redirectUri: 'https://app.test/api/auth/callback',
    });
  });

  it('usa MS_* del .env como valores por defecto', async () => {
    const { svc } = setup({
      MS_CLIENT_ID: GUID,
      MS_TENANT_ID: 'organizations',
      MS_CLIENT_SECRET: 's3',
      MS_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
    });
    const e = await svc.getEffective();
    expect(e).toEqual({
      clientId: GUID,
      tenantId: 'organizations',
      clientSecret: 's3',
      redirectUri: 'http://localhost:3000/api/auth/callback',
    });
    expect((await svc.getPublic()).tieneSecreto).toBe(true);
  });

  it('el panel gana al .env, cifra el secreto y nunca lo devuelve', async () => {
    const { svc, rows } = setup({ MS_CLIENT_ID: 'otro' });
    const pub = await svc.save({
      clientId: GUID,
      tenantId: 'consumers',
      clientSecret: 'super-secreto',
    });
    expect(pub).toMatchObject({
      configurado: true,
      clientId: GUID,
      tenantId: 'consumers',
      tieneSecreto: true,
    });
    expect(JSON.stringify(pub)).not.toContain('super-secreto');
    expect(JSON.stringify(rows.get('microsoft.config'))).not.toContain(
      'super-secreto',
    );
    expect((await svc.getEffective()).clientSecret).toBe('super-secreto');
  });

  it('clientSecret null borra el secreto; el resto se conserva', async () => {
    const { svc } = setup();
    await svc.save({ clientId: GUID, clientSecret: 'x' });
    const pub = await svc.save({ clientSecret: null });
    expect(pub.tieneSecreto).toBe(false);
    expect(pub.clientId).toBe(GUID);
  });

  it.each([
    [{ clientId: 'no-guid' }],
    [{ tenantId: 'cualquiera' }],
    [{ redirectUri: 'ftp://x' }],
    [{ clientSecret: '' }],
    [{ clientSecret: 'x'.repeat(501) }],
  ])('rechaza %j con 400', async (input) => {
    const { svc } = setup();
    await expect(svc.save(input as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
