import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp } from '../src/app.setup';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { IpThrottlerGuard } from '../src/auth/ip-throttler.guard';
import { LoginThrottlerGuard } from '../src/auth/login-throttler.guard';
import { MicrosoftService } from '../src/auth/microsoft.service';
import { MicrosoftSettingsService } from '../src/settings/microsoft-settings.service';
import { PasswordService } from '../src/auth/password.service';
import { SessionGuard } from '../src/auth/session.guard';
import { TokenCryptoService } from '../src/auth/token-crypto.service';
import { MailController } from '../src/mail/mail.controller';
import { MailSyncService } from '../src/mail/mail-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { UsersService } from '../src/users/users.service';
import { fakePrisma } from './helpers/fake-prisma';

const SECRET = 's'.repeat(48);
const PASS = 'contraseña-larga-1';
const WEB = 'http://localhost:8080';
const baseEnv: Record<string, string> = {
  TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString('base64'),
  WEB_ORIGIN: WEB,
  MS_CLIENT_ID: 'cid',
  MS_TENANT_ID: 'tenant',
};
const body = (over: Record<string, unknown> = {}) => ({
  email: 'Ana@X.com',
  nombre: 'Ana',
  password: PASS,
  ...over,
});

describe('Primer usuario y callback de escritorio (e2e, sin BD ni red)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof fakePrisma>;
  let env: Record<string, string>;

  const http = () => request(app.getHttpServer());

  async function boot(over: Record<string, string>) {
    db = fakePrisma();
    env = { ...baseEnv, ...over };
    const mod = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: SECRET }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
      ],
      controllers: [AuthController, MailController],
      providers: [
        AuthService,
        PasswordService,
        MicrosoftService,
        MicrosoftSettingsService,
        TokenCryptoService,
        SessionGuard,
        LoginThrottlerGuard,
        IpThrottlerGuard,
        UsersService,
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => env[k],
            getOrThrow: (k: string) => env[k],
          },
        },
        { provide: PrismaService, useValue: db },
        {
          provide: MailSyncService,
          useValue: { isRunning: () => false, lastResult: null },
        },
      ],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app, WEB);
    await app.init();
  }

  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });

  describe('con SETUP_TOKEN', () => {
    beforeEach(() =>
      boot({
        SETUP_TOKEN: 'token-secreto-123',
        MS_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
      }),
    );

    it('sin token o con token incorrecto -> 403', async () => {
      await http().post('/api/auth/setup').send(body()).expect(403);
      await http()
        .post('/api/auth/setup')
        .set('x-setup-token', 'otro')
        .send(body())
        .expect(403);
      expect(db.user.rows).toHaveLength(0);
    });

    it('con SETUP_TOKEN válido (cabecera o cuerpo) crea el usuario', async () => {
      await http()
        .post('/api/auth/setup')
        .set('x-setup-token', 'token-secreto-123')
        .send(body())
        .expect(200);
      expect(db.user.rows).toHaveLength(1);
      await http()
        .post('/api/auth/setup')
        .send(body({ email: 'b@x.com', setupToken: 'token-secreto-123' }))
        .expect(409);
    });

    it('sin SETUP_TOKEN configurado nunca se acepta un token vacío', async () => {
      env.SETUP_TOKEN = '';
      await http()
        .post('/api/auth/setup')
        .send(body({ setupToken: '' }))
        .expect(403);
    });

    it('el callback sigue exigiendo sesión', async () => {
      const u = await db.user.create({
        data: { email: 'u@x.com', nombre: 'U', passwordHash: 'h' },
      });
      const url = await mod(app).get(MicrosoftService).buildConnectUrl(u.id);
      const fetchSpy = jest.spyOn(global, 'fetch');
      const res = await http()
        .get('/api/auth/callback')
        .query({ code: 'abc', state: new URL(url).searchParams.get('state') })
        .expect(302);
      expect(decodeURIComponent(res.headers.location)).toMatch(/sesión caducó/);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(db.mailAccount.rows).toHaveLength(0);
    });
  });
});

function mod(app: INestApplication) {
  return { get: <T>(t: new (...a: never[]) => T) => app.get(t) };
}
