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
import { LoginThrottlerGuard } from '../src/auth/login-throttler.guard';
import { UsersService } from '../src/users/users.service';
import { MicrosoftService } from '../src/auth/microsoft.service';
import { MicrosoftSettingsService } from '../src/settings/microsoft-settings.service';
import { PasswordService } from '../src/auth/password.service';
import { SessionGuard } from '../src/auth/session.guard';
import { TokenCryptoService } from '../src/auth/token-crypto.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { OcrSettingsController } from '../src/settings/ocr-settings.controller';
import { OcrSettingsService } from '../src/settings/ocr-settings.service';
import { OcrProbeService } from '../src/ocr/ocr-probe.service';
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

describe('Ajustes de OCR (e2e, sin BD ni red)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof fakePrisma>;
  let cookie: string;
  const probe = { probe: jest.fn(), serverLocalStatus: jest.fn() };

  const http = () => request(app.getHttpServer());
  const authed = (r: request.Test) => r.set('Cookie', cookie);

  async function boot(extra: Record<string, string> = {}) {
    db = fakePrisma();
    Object.values(probe).forEach((f) => {
      if (typeof f === 'function') f.mockReset();
    });
    probe.probe.mockResolvedValue({ ok: false, ms: 1, mensaje: 'x' });
    probe.serverLocalStatus.mockResolvedValue({
      estado: 'detenido',
      mensaje:
        'El servicio de OCR no responde. Revisa que el contenedor ocr-local esté en marcha.',
    });
    const cfg = { ...env, ...extra };
    const mod = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: SECRET }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
      ],
      controllers: [AuthController, OcrSettingsController],
      providers: [
        AuthService,
        PasswordService,
        UsersService,
        MicrosoftService,
        MicrosoftSettingsService,
        TokenCryptoService,
        SessionGuard,
        LoginThrottlerGuard,
        OcrSettingsService,
        { provide: OcrProbeService, useValue: probe },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => cfg[k],
            getOrThrow: (k: string) => cfg[k],
          },
        },
        { provide: PrismaService, useValue: db },
      ],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app, WEB);
    await app.init();
    await db.user.create({
      data: {
        email: 'ocr@x.com',
        nombre: 'Ocr',
        passwordHash: await new PasswordService().hash(PASS),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email: 'ocr@x.com', password: PASS })
      .expect(200);
    cookie = (res.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
  }

  afterEach(async () => {
    await app.close();
  });

  describe('versión web', () => {
    beforeEach(() => boot());

    it('401 sin sesión en cada ruta', async () => {
      await http().get('/api/settings/ocr').expect(401);
      await http().put('/api/settings/ocr').send({}).expect(401);
      await http().post('/api/settings/ocr/probar').send({}).expect(401);
    });

    it('GET: forma del contrato, ', async () => {
      const res = await authed(http().get('/api/settings/ocr')).expect(200);
      expect(res.body).toMatchObject({
        motor: 'local',
        origen: 'servidor',
        textractMode: 'detect',
        entorno: { servidor: true },
        servicioLocal: {
          estado: 'detenido',
          mensaje: expect.stringContaining('ocr-local'),
        },
      });
    });

    it('GET: servicioLocal listo cuando el health del servidor responde', async () => {
      probe.serverLocalStatus.mockResolvedValue({
        estado: 'listo',
        fallbackReason: null,
      });
      const res = await authed(http().get('/api/settings/ocr')).expect(200);
      expect(res.body.servicioLocal).toEqual({
        estado: 'listo',
        fallbackReason: null,
      });
    });

    it('PUT guarda parcial y devuelve la misma forma; valida en español', async () => {
      const ok = await authed(
        http().put('/api/settings/ocr').send({ motor: 'ninguno' }),
      ).expect(200);
      expect(ok.body).toMatchObject({ motor: 'ninguno', origen: 'panel' });
      const r2 = await authed(
        http().put('/api/settings/ocr').send({ textractMode: 'analyze' }),
      ).expect(200);
      expect(r2.body).toMatchObject({
        motor: 'ninguno',
        textractMode: 'analyze',
      });
      const bad = await authed(
        http().put('/api/settings/ocr').send({ motor: 'gpt' }),
      );
      expect(bad.status).toBe(400);
      expect(JSON.stringify(bad.body.message)).toMatch(
        /Motor de OCR no válido/,
      );
      const bad2 = await authed(
        http().put('/api/settings/ocr').send({ textractMode: 'x' }),
      );
      expect(bad2.status).toBe(400);
    });

    it('probar delega en el servicio de prueba', async () => {
      probe.probe.mockResolvedValue({ ok: true, ms: 5, mensaje: 'ok' });
      const res = await authed(
        http().post('/api/settings/ocr/probar').send({}),
      ).expect(200);
      expect(res.body).toEqual({ ok: true, ms: 5, mensaje: 'ok' });
    });
  });
});
