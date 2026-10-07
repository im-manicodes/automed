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
import { PasswordService } from '../src/auth/password.service';
import { SessionGuard } from '../src/auth/session.guard';
import { TokenCryptoService } from '../src/auth/token-crypto.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { OcrSettingsController } from '../src/settings/ocr-settings.controller';
import { OcrSettingsService } from '../src/settings/ocr-settings.service';
import { OcrLocalRunner } from '../src/ocr/ocr-local-runner.service';
import { OcrProbeService } from '../src/ocr/ocr-probe.service';
import { PythonEnvService, buildGuide } from '../src/ocr/python-env.service';
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

describe('Ajustes de OCR (e2e, sin BD, sin Python ni red)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof fakePrisma>;
  let cookie: string;
  const python = {
    so: 'linux',
    detect: jest.fn(),
    entornoEstado: jest.fn(),
    prepare: jest.fn(),
    progress: jest.fn(),
  };
  const runner = { getStatus: jest.fn(), reconcile: jest.fn() };
  const probe = { probe: jest.fn() };

  const http = () => request(app.getHttpServer());
  const authed = (r: request.Test) => r.set('Cookie', cookie);

  async function boot(extra: Record<string, string> = {}) {
    db = fakePrisma();
    Object.values({ ...python, ...runner, ...probe }).forEach((f) => {
      if (typeof f === 'function') f.mockReset();
    });
    python.detect.mockResolvedValue({
      requerido: '3.11',
      rango: '3.9 a 3.12',
      detectado: true,
      version: '3.11.4',
      ejecutable: '/usr/bin/python3.11',
      compatible: true,
      guia: buildGuide('linux'),
      cmd: '/usr/bin/python3.11',
      cmdArgs: [],
    });
    python.entornoEstado.mockReturnValue({ estado: 'sin_preparar' });
    python.prepare.mockResolvedValue({ estado: 'preparando' });
    python.progress.mockReturnValue({ estado: 'inactivo', lineas: [] });
    runner.getStatus.mockReturnValue({ estado: 'detenido' });
    runner.reconcile.mockResolvedValue(undefined);
    probe.probe.mockResolvedValue({ ok: false, ms: 1, mensaje: 'x' });
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
        TokenCryptoService,
        SessionGuard,
        LoginThrottlerGuard,
        OcrSettingsService,
        { provide: PythonEnvService, useValue: python },
        { provide: OcrLocalRunner, useValue: runner },
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

  describe('fuera de escritorio', () => {
    beforeEach(() => boot());

    it('401 sin sesión en cada ruta', async () => {
      await http().get('/api/settings/ocr').expect(401);
      await http().put('/api/settings/ocr').send({}).expect(401);
      await http()
        .post('/api/settings/ocr/python/instalar')
        .send({})
        .expect(401);
      await http().get('/api/settings/ocr/python/progreso').expect(401);
      await http().post('/api/settings/ocr/probar').send({}).expect(401);
    });

    it('GET: forma del contrato, sin consultar Python', async () => {
      const res = await authed(http().get('/api/settings/ocr')).expect(200);
      expect(res.body).toMatchObject({
        motor: 'local',
        origen: 'servidor',
        textractMode: 'detect',
        entorno: { escritorio: false, so: 'linux' },
        python: {
          requerido: '3.11',
          rango: '3.9 a 3.12',
          detectado: false,
          compatible: false,
          guia: {
            titulo: expect.any(String),
            pasos: expect.any(Array),
            comandos: expect.any(Array),
          },
        },
        entornoPython: { estado: 'sin_preparar' },
        servicioLocal: { estado: 'detenido' },
      });
      expect(python.detect).not.toHaveBeenCalled();
    });

    it('PUT guarda parcial y devuelve la misma forma; valida en español', async () => {
      const ok = await authed(
        http().put('/api/settings/ocr').send({ motor: 'ninguno' }),
      ).expect(200);
      expect(ok.body).toMatchObject({ motor: 'ninguno', origen: 'panel' });
      expect(runner.reconcile).toHaveBeenCalled();
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

    it('409 en los endpoints de Python', async () => {
      const a = await authed(
        http().post('/api/settings/ocr/python/instalar').send({}),
      );
      expect(a.status).toBe(409);
      expect(a.body.message).toBe('No disponible en este entorno');
      await authed(http().get('/api/settings/ocr/python/progreso')).expect(409);
      expect(python.prepare).not.toHaveBeenCalled();
    });

    it('probar delega en el servicio de prueba', async () => {
      probe.probe.mockResolvedValue({ ok: true, ms: 5, mensaje: 'ok' });
      const res = await authed(
        http().post('/api/settings/ocr/probar').send({}),
      ).expect(200);
      expect(res.body).toEqual({ ok: true, ms: 5, mensaje: 'ok' });
    });
  });

  describe('modo escritorio', () => {
    beforeEach(() => boot({ APP_MODE: 'desktop' }));

    it('GET incluye Python detectado, sin datos internos', async () => {
      runner.getStatus.mockReturnValue({
        estado: 'listo',
        fallbackReason: null,
      });
      const res = await authed(http().get('/api/settings/ocr')).expect(200);
      expect(res.body.entorno.escritorio).toBe(true);
      expect(res.body.python).toMatchObject({
        detectado: true,
        version: '3.11.4',
        compatible: true,
      });
      expect(res.body.python.cmd).toBeUndefined();
      expect(res.body.servicioLocal).toEqual({
        estado: 'listo',
        fallbackReason: null,
      });
    });

    it('instalar responde 202 y progreso devuelve líneas', async () => {
      const a = await authed(
        http().post('/api/settings/ocr/python/instalar').send({}),
      );
      expect(a.status).toBe(202);
      expect(a.body).toEqual({ estado: 'preparando' });
      python.progress.mockReturnValue({
        estado: 'preparando',
        lineas: ['Collecting x'],
      });
      const p = await authed(
        http().get('/api/settings/ocr/python/progreso'),
      ).expect(200);
      expect(p.body).toEqual({
        estado: 'preparando',
        lineas: ['Collecting x'],
      });
    });
  });
});
