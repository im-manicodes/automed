import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp } from '../src/app.setup';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { IpThrottlerGuard } from '../src/auth/ip-throttler.guard';
import { LoginThrottlerGuard } from '../src/auth/login-throttler.guard';
import { MicrosoftService } from '../src/auth/microsoft.service';
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
  let jwt: JwtService;
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
    jwt = mod.get(JwtService);
  }

  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });

  describe('modo escritorio', () => {
    beforeEach(() => boot({ APP_MODE: 'desktop' }));

    it('estado inicial: needsSetup=true; tras crear, false', async () => {
      const a = await http().get('/api/auth/setup-status').expect(200);
      expect(a.body.needsSetup).toBe(true);
      await http().post('/api/auth/setup').send(body()).expect(200);
      const b = await http().get('/api/auth/setup-status').expect(200);
      expect(b.body.needsSetup).toBe(false);
    });

    it('crea el usuario, abre sesión con cookies y marca setup.done', async () => {
      const res = await http().post('/api/auth/setup').send(body()).expect(200);
      expect(res.body.user).toMatchObject({
        email: 'ana@x.com',
        nombre: 'Ana',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
      const sc = (res.headers['set-cookie'] as unknown as string[]).join('\n');
      expect(sc).toMatch(/am_access=.*HttpOnly.*SameSite=Lax/);
      expect(sc).toMatch(/am_refresh=.*Path=\/api\/auth.*HttpOnly/);
      expect(sc).not.toMatch(/Secure/);
      expect(db.user.rows).toHaveLength(1);
      expect(db.setting.rows.find((r) => r.key === 'setup.done')).toBeDefined();
      const access = /am_access=([^;]+)/.exec(sc)![1];
      await http()
        .get('/api/auth/me')
        .set('Cookie', `am_access=${access}`)
        .expect(200)
        .expect((r) => expect(r.body.authenticated).toBe(true));
    });

    it('segundo setup -> 409 sin más detalle y sin crear otro usuario', async () => {
      await http().post('/api/auth/setup').send(body()).expect(200);
      const r = await http()
        .post('/api/auth/setup')
        .send(body({ email: 'otro@x.com' }))
        .expect(409);
      expect(r.body.message).toBe('La configuración inicial ya se hizo');
      expect(db.user.rows).toHaveLength(1);
    });

    it('concurrencia: dos peticiones simultáneas crean un solo usuario', async () => {
      const [a, b] = await Promise.all([
        http()
          .post('/api/auth/setup')
          .send(body({ email: 'a@x.com' })),
        http()
          .post('/api/auth/setup')
          .send(body({ email: 'b@x.com' })),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(db.user.rows).toHaveLength(1);
    });

    it.each([
      ['contraseña débil', { password: 'corta' }, /al menos 10/],
      ['correo inválido', { email: 'no-es-correo' }, /correo/],
      ['nombre vacío', { nombre: '  ' }, /nombre/],
    ])('400 en español por %s', async (_n, over, re) => {
      const r = await http()
        .post('/api/auth/setup')
        .send(body(over))
        .expect(400);
      expect(r.body.message).toMatch(re);
      expect(db.user.rows).toHaveLength(0);
    });

    it('400 si faltan campos; 403 con Origin ajeno', async () => {
      await http()
        .post('/api/auth/setup')
        .send({ email: 'a@x.com' })
        .expect(400);
      await http()
        .post('/api/auth/setup')
        .set('Origin', 'https://evil.example')
        .send(body())
        .expect(403);
      expect(db.user.rows).toHaveLength(0);
    });

    it('throttle estricto: la 4.ª petición en un minuto -> 429', async () => {
      for (let i = 0; i < 3; i++) {
        await http()
          .post('/api/auth/setup')
          .send(body({ password: 'x' }))
          .expect(400);
      }
      await http().post('/api/auth/setup').send(body()).expect(429);
    });

    it('callback sin cookie de sesión: state válido conecta y responde HTML', async () => {
      const u = await db.user.create({
        data: { email: 'u@x.com', nombre: 'U', passwordHash: 'h' },
      });
      const ms = mod(app).get(MicrosoftService);
      const url = ms.buildConnectUrl(u.id);
      expect(new URL(url).searchParams.get('redirect_uri')).toBe(
        'http://localhost:3000/api/auth/callback',
      );
      jest.spyOn(global, 'fetch').mockImplementation((input: unknown) =>
        Promise.resolve(
          String(input).includes('/oauth2/v2.0/token')
            ? new Response(
                JSON.stringify({
                  access_token: 'at',
                  refresh_token: 'rt',
                  expires_in: 3600,
                }),
              )
            : new Response(JSON.stringify({ mail: 'buzon@x.com' })),
        ),
      );
      const res = await http()
        .get('/api/auth/callback')
        .query({ code: 'abc', state: new URL(url).searchParams.get('state') })
        .expect(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text).toContain('Ya puedes volver a la aplicación');
      expect(db.mailAccount.rows[0]).toMatchObject({
        email: 'buzon@x.com',
        userId: u.id,
      });
    });

    it.each([
      ['inválido', () => 'basura'],
      [
        'expirado',
        (id: string) =>
          jwt.sign(
            { cv: 'x' },
            { subject: id, audience: 'ms-state', expiresIn: -5 },
          ),
      ],
      [
        'de otra clave',
        (id: string) =>
          new JwtService({ secret: 'q'.repeat(48) }).sign(
            { cv: 'x' },
            { subject: id, audience: 'ms-state' },
          ),
      ],
      [
        'con otra audiencia (access token)',
        (id: string) =>
          jwt.sign({ cv: 'x' }, { subject: id, audience: 'access' }),
      ],
    ])('callback con state %s -> 400 y nada guardado', async (_n, make) => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      const res = await http()
        .get('/api/auth/callback')
        .query({ code: 'abc', state: make('u1') })
        .expect(400);
      expect(res.text).toContain('No se pudo conectar Outlook');
      expect(db.mailAccount.rows).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('callback cancelado -> 400 legible', async () => {
      const res = await http()
        .get('/api/auth/callback')
        .query({ error: 'access_denied' })
        .expect(400);
      expect(res.text).toContain('Se canceló');
    });
  });

  describe('modo normal (hosted)', () => {
    beforeEach(() =>
      boot({
        SETUP_TOKEN: 'token-secreto-123',
        MS_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
      }),
    );

    it('sin APP_MODE=desktop y sin token -> 403', async () => {
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
      const url = mod(app).get(MicrosoftService).buildConnectUrl(u.id);
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
