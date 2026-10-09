import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
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
import { LogsController } from '../src/logs/logs.controller';
import { LogBufferService } from '../src/logs/log-buffer.service';
import { AppLogger } from '../src/logs/app-logger';
import { AllExceptionsFilter } from '../src/logs/all-exceptions.filter';
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

/** Ruta de prueba que falla para comprobar que el filtro global registra el 5xx. */
@Controller('boom')
@UseGuards(SessionGuard)
class BoomController {
  @Get()
  boom() {
    throw new Error('fallo con sk-secreto1234567');
  }
}

describe('Registro de la API (e2e, sin BD ni red)', () => {
  let app: INestApplication<App>;
  let buffer: LogBufferService;
  let cookie: string;

  const http = () => request(app.getHttpServer());
  const authed = (r: request.Test) => r.set('Cookie', cookie);

  beforeEach(async () => {
    const db = fakePrisma();
    const mod = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: SECRET }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
      ],
      controllers: [AuthController, LogsController, BoomController],
      providers: [
        AuthService,
        PasswordService,
        UsersService,
        MicrosoftService,
        MicrosoftSettingsService,
        TokenCryptoService,
        SessionGuard,
        LoginThrottlerGuard,
        LogBufferService,
        AppLogger,
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => env[k],
            getOrThrow: (k: string) => env[k],
          },
        },
        { provide: PrismaService, useValue: db },
      ],
    }).compile();
    app = mod.createNestApplication({ bufferLogs: true });
    const logger = app.get(AppLogger);
    logger.setLogLevels(['error', 'warn', 'log']);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    app.useLogger(logger);
    configureApp(app, WEB);
    await app.init();
    buffer = app.get(LogBufferService);
    await db.user.create({
      data: {
        email: 'log@x.com',
        nombre: 'Log',
        passwordHash: await new PasswordService().hash(PASS),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email: 'log@x.com', password: PASS })
      .expect(200);
    cookie = (res.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('401 sin sesión en cada ruta', async () => {
    await http().get('/api/settings/logs').expect(401);
    await http().get('/api/settings/logs/descargar').expect(401);
    await http().delete('/api/settings/logs').expect(401);
  });

  it('GET lista con filtros y polling incremental', async () => {
    buffer.append('error', 'Prueba', 'algo falló');
    buffer.append('log', 'Prueba', 'todo bien');
    const all = await authed(
      http().get('/api/settings/logs').query({ q: 'prueba' }),
    ).expect(200);
    expect(all.body.entries.map((e: { mensaje: string }) => e.mensaje)).toEqual(
      ['algo falló', 'todo bien'],
    );
    const errs = await authed(
      http().get('/api/settings/logs').query({ nivel: 'error', q: 'prueba' }),
    ).expect(200);
    expect(errs.body.entries).toHaveLength(1);
    const next = await authed(
      http().get('/api/settings/logs').query({ desde: all.body.ultimoId }),
    ).expect(200);
    expect(next.body.entries).toEqual([]);
    await authed(
      http().get('/api/settings/logs').query({ nivel: 'todo' }),
    ).expect(400);
    await authed(
      http().get('/api/settings/logs').query({ desde: '-1' }),
    ).expect(400);
  });

  it('un 5xx queda registrado y saneado', async () => {
    await authed(http().get('/api/boom').query({ x: 'privado' })).expect(500);
    const res = await authed(
      http().get('/api/settings/logs').query({ nivel: 'error' }),
    ).expect(200);
    const txt = JSON.stringify(res.body.entries);
    expect(txt).toContain('GET /api/boom -> 500');
    expect(txt).toContain('sk-[oculto]');
    expect(txt).not.toMatch(/privado|secreto1234567/);
  });

  it('descargar devuelve texto plano y DELETE limpia', async () => {
    buffer.append('warn', 'Prueba', 'aviso');
    const dl = await authed(http().get('/api/settings/logs/descargar')).expect(
      200,
    );
    expect(dl.headers['content-type']).toMatch(/text\/plain/);
    expect(dl.headers['content-disposition']).toMatch(/registro-api-/);
    expect(dl.text).toContain('[Prueba] aviso');
    await authed(http().delete('/api/settings/logs')).expect(204);
    expect(buffer.size()).toBe(0);
  });
});
