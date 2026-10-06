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
import { LoginThrottlerGuard } from '../src/auth/login-throttler.guard';
import { MicrosoftService } from '../src/auth/microsoft.service';
import { PasswordService } from '../src/auth/password.service';
import { SessionGuard } from '../src/auth/session.guard';
import { TokenCryptoService } from '../src/auth/token-crypto.service';
import { MailController } from '../src/mail/mail.controller';
import { MailSyncService } from '../src/mail/mail-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { fakePrisma } from './helpers/fake-prisma';

const SECRET = 's'.repeat(48);
const PASS = 'contraseña-larga-1';
const WEB = 'http://localhost:8080';
const env: Record<string, string> = {
  TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString('base64'),
  WEB_ORIGIN: WEB,
  MS_CLIENT_ID: 'cid',
  MS_TENANT_ID: 'tenant',
  MS_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
};

describe('Auth + conexión Outlook (e2e, sin BD ni red)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof fakePrisma>;
  let jwt: JwtService;
  let sync: { syncNow: jest.Mock; isRunning: jest.Mock; lastResult: unknown };
  let n = 0;

  const http = () => request(app.getHttpServer());
  const cookiesOf = (res: request.Response): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const c of (res.headers['set-cookie'] as unknown as string[]) ?? []) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      out[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return out;
  };
  const header = (c: Record<string, string>) =>
    Object.entries(c)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

  /** Crea un usuario nuevo (el límite de login es por correo) y abre sesión. */
  async function newSession() {
    const email = `u${++n}@x.com`;
    const passwords = new PasswordService();
    const user = await db.user.create({
      data: {
        email,
        nombre: `Usuario ${n}`,
        passwordHash: await passwords.hash(PASS),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: PASS })
      .expect(200);
    return { email, user, res, cookies: cookiesOf(res) };
  }

  beforeEach(async () => {
    db = fakePrisma();
    sync = {
      syncNow: jest.fn().mockResolvedValue({ started: true }),
      isRunning: jest.fn().mockReturnValue(false),
      lastResult: null,
    };
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
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => env[k],
            getOrThrow: (k: string) => env[k],
          },
        },
        { provide: PrismaService, useValue: db },
        { provide: MailSyncService, useValue: sync },
      ],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app, WEB);
    await app.init();
    jwt = mod.get(JwtService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  describe('login', () => {
    it('ok: 200, {user}, cookies HttpOnly SameSite=Lax', async () => {
      const { res, email } = await newSession();
      expect(res.body.user).toMatchObject({ email });
      expect(res.body.user.id).toBeDefined();
      expect(JSON.stringify(res.body)).not.toMatch(/password|token/i);
      const sc = (res.headers['set-cookie'] as unknown as string[]).join('\n');
      expect(sc).toMatch(/am_access=.*HttpOnly.*SameSite=Lax/);
      expect(sc).toMatch(/am_refresh=.*Path=\/api\/auth.*HttpOnly/);
    });

    it('fallo: 401 genérico igual para usuario inexistente y contraseña mala', async () => {
      const { email } = await newSession();
      const a = await http()
        .post('/api/auth/login')
        .send({ email, password: 'incorrecta-123' })
        .expect(401);
      const b = await http()
        .post('/api/auth/login')
        .send({ email: 'no@x.com', password: 'incorrecta-123' })
        .expect(401);
      expect(a.body.message).toBe('Correo o contraseña incorrectos');
      expect(b.body.message).toBe(a.body.message);
      expect(a.headers['set-cookie']).toBeUndefined();
    });

    it('429 tras 5 intentos por IP+correo, con mensaje claro', async () => {
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/api/auth/login')
          .send({ email: 'brute@x.com', password: 'incorrecta-123' })
          .expect(401);
      }
      const res = await http()
        .post('/api/auth/login')
        .send({ email: 'brute@x.com', password: 'incorrecta-123' })
        .expect(429);
      expect(res.body.message).toMatch(/Demasiados intentos/);
      // otro correo desde la misma IP no está bloqueado
      await http()
        .post('/api/auth/login')
        .send({ email: 'otro@x.com', password: 'incorrecta-123' })
        .expect(401);
    });
  });

  describe('me / refresh / logout', () => {
    it('me: público; con sesión devuelve user, sin ella authenticated=false', async () => {
      await http().get('/api/auth/me').expect(200, { authenticated: false });
      const s = await newSession();
      const res = await http()
        .get('/api/auth/me')
        .set('Cookie', header(s.cookies))
        .expect(200);
      expect(res.body).toEqual({
        authenticated: true,
        user: { id: s.user.id, email: s.email, nombre: s.user.nombre },
      });
    });

    it('refresh rota cookies; reusar el refresh viejo -> 401 y revoca la familia', async () => {
      const s = await newSession();
      const r = await http()
        .post('/api/auth/refresh')
        .set('Cookie', `am_refresh=${s.cookies.am_refresh}`)
        .expect(200);
      const next = cookiesOf(r);
      expect(next.am_refresh).not.toBe(s.cookies.am_refresh);
      expect(r.body.user.email).toBe(s.email);
      // reuso del viejo
      await http()
        .post('/api/auth/refresh')
        .set('Cookie', `am_refresh=${s.cookies.am_refresh}`)
        .expect(401);
      // la familia quedó revocada: el nuevo tampoco sirve
      await http()
        .post('/api/auth/refresh')
        .set('Cookie', `am_refresh=${next.am_refresh}`)
        .expect(401);
    });

    it('refresh sin cookie -> 401', async () => {
      await http().post('/api/auth/refresh').expect(401);
    });

    it('logout: 204, borra cookies y revoca el refresh', async () => {
      const s = await newSession();
      const res = await http()
        .post('/api/auth/logout')
        .set('Cookie', header(s.cookies))
        .expect(204);
      const sc = (res.headers['set-cookie'] as unknown as string[]).join('\n');
      expect(sc).toMatch(/am_access=;.*Max-Age=0/);
      expect(sc).toMatch(/am_refresh=;.*Max-Age=0/);
      await http()
        .post('/api/auth/refresh')
        .set('Cookie', `am_refresh=${s.cookies.am_refresh}`)
        .expect(401);
    });
  });

  describe('change-password', () => {
    it('exige sesión', async () => {
      await http()
        .post('/api/auth/change-password')
        .send({ actual: PASS, nueva: 'nueva-contraseña-1' })
        .expect(401);
    });

    it('204, valida política y contraseña actual, revoca otras sesiones', async () => {
      const s = await newSession();
      const other = await http()
        .post('/api/auth/login')
        .send({ email: s.email, password: PASS })
        .expect(200);
      const otherC = cookiesOf(other);
      const c = header(s.cookies);
      await http()
        .post('/api/auth/change-password')
        .set('Cookie', c)
        .send({ actual: PASS, nueva: 'corta' })
        .expect(400);
      await http()
        .post('/api/auth/change-password')
        .set('Cookie', c)
        .send({ actual: 'mala-mala-mala', nueva: 'nueva-contraseña-1' })
        .expect(401);
      await http()
        .post('/api/auth/change-password')
        .set('Cookie', c)
        .send({ actual: PASS, nueva: 'nueva-contraseña-1' })
        .expect(204);
      await http()
        .post('/api/auth/refresh')
        .set('Cookie', `am_refresh=${otherC.am_refresh}`)
        .expect(401);
      await http()
        .post('/api/auth/refresh')
        .set('Cookie', `am_refresh=${s.cookies.am_refresh}`)
        .expect(200);
    });
  });

  describe('guard con JWT', () => {
    it('inválido, expirado y de otra clave -> 401; válido -> 200', async () => {
      const s = await newSession();
      await http()
        .get('/api/mail/status')
        .set('Cookie', 'am_access=abc.def.ghi')
        .expect(401);
      const expired = jwt.sign(
        { email: s.email },
        { subject: s.user.id, audience: 'access', expiresIn: -5 },
      );
      await http()
        .get('/api/mail/status')
        .set('Cookie', `am_access=${expired}`)
        .expect(401);
      const forged = new JwtService({ secret: 'z'.repeat(48) }).sign(
        { email: s.email },
        { subject: s.user.id, audience: 'access' },
      );
      await http()
        .get('/api/mail/status')
        .set('Cookie', `am_access=${forged}`)
        .expect(401);
      await http()
        .get('/api/mail/status')
        .set('Cookie', header(s.cookies))
        .expect(200);
    });

    it('el state de Microsoft no sirve como access token', async () => {
      const s = await newSession();
      const st = jwt.sign(
        { cv: 'x' },
        { subject: s.user.id, audience: 'ms-state' },
      );
      await http()
        .get('/api/mail/status')
        .set('Cookie', `am_access=${st}`)
        .expect(401);
    });
  });

  describe('Origin y Content-Type', () => {
    it('rechaza Origin ajeno (403) y cuerpos no JSON (415)', async () => {
      await http()
        .post('/api/auth/logout')
        .set('Origin', 'https://evil.example')
        .expect(403);
      await http().post('/api/auth/logout').set('Origin', WEB).expect(204);
      await http()
        .post('/api/auth/login')
        .set('Content-Type', 'text/plain')
        .send('email=a')
        .expect(415);
    });
  });

  describe('conexión con Outlook', () => {
    const stateOf = (url: string) => new URL(url).searchParams.get('state')!;
    const mockMicrosoft = (profileMail = 'buzon@x.com') =>
      jest.spyOn(global, 'fetch').mockImplementation((input: unknown) => {
        const url = String(input);
        if (url.includes('/oauth2/v2.0/token')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: 'at',
                refresh_token: 'rt-secreto',
                expires_in: 3600,
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ mail: profileMail }), { status: 200 }),
        );
      });

    it('connect exige sesión y devuelve url con PKCE y state firmado', async () => {
      await http().post('/api/mail/connect').expect(401);
      const s = await newSession();
      const res = await http()
        .post('/api/mail/connect')
        .set('Cookie', header(s.cookies))
        .expect(200);
      const u = new URL(res.body.url);
      expect(u.host).toBe('login.microsoftonline.com');
      expect(u.searchParams.get('code_challenge_method')).toBe('S256');
      expect(u.searchParams.get('redirect_uri')).toBe(env.MS_REDIRECT_URI);
      const payload = jwt.verify(stateOf(res.body.url), {
        audience: 'ms-state',
      });
      expect(payload.sub).toBe(s.user.id);
      expect(JSON.stringify(payload)).not.toContain(
        u.searchParams.get('code_challenge')!,
      );
    });

    it.each([['common'], ['']])(
      'con MS_TENANT_ID=%j la autorización apunta a /common',
      async (tenant) => {
        const prev = env.MS_TENANT_ID;
        env.MS_TENANT_ID = tenant;
        try {
          const s = await newSession();
          const res = await http()
            .post('/api/mail/connect')
            .set('Cookie', header(s.cookies))
            .expect(200);
          const u = new URL(res.body.url);
          expect(u.pathname).toBe('/common/oauth2/v2.0/authorize');
        } finally {
          env.MS_TENANT_ID = prev;
        }
      },
    );

    it('callback ok: guarda token cifrado ligado al usuario y redirige a Ajustes', async () => {
      const s = await newSession();
      const c = header(s.cookies);
      const { body } = await http()
        .post('/api/mail/connect')
        .set('Cookie', c)
        .expect(200);
      mockMicrosoft();
      const res = await http()
        .get('/api/auth/callback')
        .query({ code: 'abc', state: stateOf(body.url) })
        .set('Cookie', c)
        .expect(302);
      expect(res.headers.location).toBe(`${WEB}/ajustes?outlook=conectado`);
      const acc = db.mailAccount.rows[0];
      expect(acc).toMatchObject({ email: 'buzon@x.com', userId: s.user.id });
      expect(acc.tokenEnc).toMatch(/^v1\./);
      expect(acc.tokenEnc).not.toContain('rt-secreto');
    });

    it.each([
      ['state inválido', () => 'basura'],
      [
        'state expirado',
        (uid: string) =>
          jwt.sign(
            { cv: 'x' },
            { subject: uid, audience: 'ms-state', expiresIn: -5 },
          ),
      ],
      [
        'state firmado con otra clave',
        (uid: string) =>
          new JwtService({ secret: 'q'.repeat(48) }).sign(
            { cv: 'x' },
            { subject: uid, audience: 'ms-state' },
          ),
      ],
    ])(
      'callback con %s -> error en Ajustes y sin guardar nada',
      async (_n, make) => {
        const s = await newSession();
        const fetchSpy = mockMicrosoft();
        const res = await http()
          .get('/api/auth/callback')
          .query({ code: 'abc', state: make(s.user.id) })
          .set('Cookie', header(s.cookies))
          .expect(302);
        expect(res.headers.location).toMatch(
          `${WEB}/ajustes?outlook=error&motivo=`,
        );
        expect(db.mailAccount.rows).toHaveLength(0);
        expect(fetchSpy).not.toHaveBeenCalled();
      },
    );

    it('callback con state de OTRO usuario o sin sesión -> error', async () => {
      const a = await newSession();
      const b = await newSession();
      const { body } = await http()
        .post('/api/mail/connect')
        .set('Cookie', header(a.cookies))
        .expect(200);
      mockMicrosoft();
      const other = await http()
        .get('/api/auth/callback')
        .query({ code: 'abc', state: stateOf(body.url) })
        .set('Cookie', header(b.cookies))
        .expect(302);
      expect(other.headers.location).toMatch(/outlook=error&motivo=/);
      expect(decodeURIComponent(other.headers.location)).toMatch(
        /no corresponde a tu sesión/,
      );
      const anon = await http()
        .get('/api/auth/callback')
        .query({ code: 'abc', state: stateOf(body.url) })
        .expect(302);
      expect(decodeURIComponent(anon.headers.location)).toMatch(
        /sesión caducó/,
      );
      expect(db.mailAccount.rows).toHaveLength(0);
    });

    it('callback cancelado por el usuario en Microsoft -> error legible', async () => {
      const s = await newSession();
      const res = await http()
        .get('/api/auth/callback')
        .query({ error: 'access_denied' })
        .set('Cookie', header(s.cookies))
        .expect(302);
      expect(decodeURIComponent(res.headers.location)).toMatch(/Se canceló/);
    });

    it('status / sync / disconnect', async () => {
      const s = await newSession();
      const c = header(s.cookies);
      // sin conexión
      await http()
        .get('/api/mail/status')
        .set('Cookie', c)
        .expect(200, { connected: false, syncing: false });
      const r409 = await http()
        .post('/api/mail/sync')
        .set('Cookie', c)
        .expect(409);
      expect(r409.body.message).toBe('Conecta tu Outlook primero');
      expect(sync.syncNow).not.toHaveBeenCalled();
      // conectado
      await db.mailAccount.create({
        data: {
          email: 'buzon@x.com',
          tokenEnc: 'enc',
          userId: s.user.id,
          lastSyncAt: new Date('2026-01-01T00:00:00Z'),
        },
      });
      await db.thread.create({
        data: { accountId: db.mailAccount.rows[0].id },
      });
      await db.mailFolderSync.create({
        data: { accountId: db.mailAccount.rows[0].id },
      });
      const st = await http()
        .get('/api/mail/status')
        .set('Cookie', c)
        .expect(200);
      expect(st.body).toEqual({
        connected: true,
        email: 'buzon@x.com',
        lastSyncAt: '2026-01-01T00:00:00.000Z',
        syncing: false,
      });
      await http().post('/api/mail/sync').set('Cookie', c).expect(201);
      expect(sync.syncNow).toHaveBeenCalledTimes(1);
      // desconectar: borra tokens, conserva hilos
      await http().delete('/api/mail/connection').set('Cookie', c).expect(204);
      expect(db.mailAccount.rows[0].tokenEnc).toBeNull();
      expect(db.mailFolderSync.rows).toHaveLength(0);
      expect(db.thread.rows).toHaveLength(1);
      await http()
        .get('/api/mail/status')
        .set('Cookie', c)
        .expect(200, { connected: false, syncing: false });
      await http().post('/api/mail/sync').set('Cookie', c).expect(409);
    });

    it('status expone el error del último sync', async () => {
      const s = await newSession();
      await db.mailAccount.create({
        data: { email: 'b@x.com', tokenEnc: 'enc', userId: s.user.id },
      });
      sync.lastResult = { error: 'Graph 500' };
      const st = await http()
        .get('/api/mail/status')
        .set('Cookie', header(s.cookies))
        .expect(200);
      expect(st.body.error).toBe('Graph 500');
    });
  });
});
