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
import { UsersService } from '../src/users/users.service';
import { MicrosoftService } from '../src/auth/microsoft.service';
import { PasswordService } from '../src/auth/password.service';
import { SessionGuard } from '../src/auth/session.guard';
import { TokenCryptoService } from '../src/auth/token-crypto.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiSettingsService } from '../src/settings/ai-settings.service';
import { AiTestService } from '../src/settings/ai-test.service';
import { HardwareService } from '../src/settings/hardware.service';
import { OllamaService } from '../src/settings/ollama.service';
import { SettingsController } from '../src/settings/settings.controller';
import * as factory from '../src/llm/llm-provider.factory';
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
const KEY = 'sk-clave-secreta-12345';

describe('Ajustes de IA (e2e, sin BD ni red)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof fakePrisma>;
  let cookie: string;
  const hardware = { detect: jest.fn() };
  const ollama = { startPull: jest.fn(), status: jest.fn() };

  const http = () => request(app.getHttpServer());
  const authed = (r: request.Test) => r.set('Cookie', cookie);

  beforeEach(async () => {
    db = fakePrisma();
    hardware.detect.mockReset();
    ollama.startPull.mockReset();
    ollama.status.mockReset();
    const mod = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: SECRET }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
      ],
      controllers: [AuthController, SettingsController],
      providers: [
        AuthService,
        PasswordService,
        MicrosoftService,
        TokenCryptoService,
        SessionGuard,
        LoginThrottlerGuard,
        IpThrottlerGuard,
        UsersService,
        AiSettingsService,
        AiTestService,
        { provide: HardwareService, useValue: hardware },
        { provide: OllamaService, useValue: ollama },
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
    app = mod.createNestApplication();
    configureApp(app, WEB);
    await app.init();

    const email = 'ia@x.com';
    await db.user.create({
      data: {
        email,
        nombre: 'Ia',
        passwordHash: await new PasswordService().hash(PASS),
      },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: PASS })
      .expect(200);
    cookie = (res.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('401 sin sesión en cada ruta', async () => {
    await http().get('/api/settings/ia').expect(401);
    await http().put('/api/settings/ia').send({}).expect(401);
    await http().post('/api/settings/ia/test').send({}).expect(401);
    await http().get('/api/settings/ia/hardware').expect(401);
    await http()
      .post('/api/settings/ia/ollama/pull')
      .send({ modelo: 'm' })
      .expect(401);
    await http().get('/api/settings/ia/ollama/pull?modelo=m').expect(401);
  });

  it('GET: valores por defecto, necesita bienvenida y nunca claves', async () => {
    const res = await authed(http().get('/api/settings/ia')).expect(200);
    expect(res.body).toMatchObject({
      necesitaBienvenida: true,
      origen: 'servidor',
      claves: { openai: false, anthropic: false },
    });
    expect(res.body.sugeridos.ollama.texto[0]).toBe('qwen3-vl:4b-instruct');
    expect(JSON.stringify(res.body)).not.toMatch(/Enc|sk-/);
  });

  it('PUT valida con mensajes en español', async () => {
    const bad = async (body: unknown, msg: RegExp) => {
      const r = await authed(
        http()
          .put('/api/settings/ia')
          .send(body as object),
      );
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body.message)).toMatch(msg);
    };
    await bad({ proveedor: 'gemini' }, /Proveedor no válido/);
    await bad({ modelos: { resumen: '' } }, /modelo debe tener/);
    await bad({ modelos: { otra: 'x' } }, /Tarea desconocida/);
    await bad({ ollamaUrl: 'ftp://x' }, /http/);
    await bad({ maxInputTokens: 1999 }, /al menos 2000/);
    await bad({ claveOpenai: '' }, /no es válida/);
    expect(db.setting.rows).toHaveLength(0);
  });

  it('PUT guarda la clave CIFRADA y GET solo informa que existe', async () => {
    const put = await authed(http().put('/api/settings/ia'))
      .send({ proveedor: 'openai', claveOpenai: KEY })
      .expect(200);
    expect(put.body.claves).toEqual({
      openai: true,
      anthropic: false,
      aws: false,
    });
    expect(put.body.proveedor).toBe('openai');
    expect(put.body.origen).toBe('panel');
    expect(JSON.stringify(put.body)).not.toContain(KEY);

    const stored = db.setting.rows.find((r) => r.key === 'ia.config');
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored!.value)).not.toContain(KEY);
    expect(stored!.value.openaiKeyEnc).toEqual(expect.any(String));

    const get = await authed(http().get('/api/settings/ia')).expect(200);
    expect(get.body.claves.openai).toBe(true);
    expect(JSON.stringify(get.body)).not.toMatch(new RegExp(KEY + '|Enc'));

    const del = await authed(http().put('/api/settings/ia'))
      .send({ claveOpenai: null })
      .expect(200);
    expect(del.body.claves.openai).toBe(false);
  });

  it('PUT {bienvenidaCompletada:true} -> necesitaBienvenida false', async () => {
    const res = await authed(http().put('/api/settings/ia'))
      .send({ bienvenidaCompletada: true })
      .expect(200);
    expect(res.body.necesitaBienvenida).toBe(false);
    const get = await authed(http().get('/api/settings/ia')).expect(200);
    expect(get.body.necesitaBienvenida).toBe(false);
  });

  it('POST test: prueba con el borrador, sin persistirlo ni eco de la clave', async () => {
    const complete = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error(KEY), { status: 401 }))
      .mockResolvedValueOnce('OK');
    jest
      .spyOn(factory, 'createLlmProvider')
      .mockReturnValue({ complete } as never);

    const bad = await authed(http().post('/api/settings/ia/test'))
      .send({ proveedor: 'openai', claveOpenai: KEY })
      .expect(200);
    expect(bad.body).toMatchObject({
      ok: false,
      mensaje: 'La clave no es válida o no tiene permiso.',
    });
    expect(JSON.stringify(bad.body)).not.toContain(KEY);

    const ok = await authed(http().post('/api/settings/ia/test'))
      .send({ proveedor: 'openai', claveOpenai: KEY })
      .expect(200);
    expect(ok.body).toMatchObject({ ok: true, mensaje: 'Funciona.' });
    expect(ok.body.ms).toEqual(expect.any(Number));
    expect(db.setting.rows).toHaveLength(0);
  });

  it('POST test: borrador inválido -> 400', async () => {
    await authed(http().post('/api/settings/ia/test'))
      .send({ proveedor: 'x' })
      .expect(400);
  });

  it('GET hardware devuelve lo del servicio', async () => {
    const info = {
      entorno: 'local',
      ramGb: 16,
      cpus: 8,
      ollama: { alcanzable: false, modelos: [] },
      ollamaApto: { apto: true, velocidad: 'lenta', motivo: 'ok' },
    };
    hardware.detect.mockResolvedValue(info);
    const res = await authed(http().get('/api/settings/ia/hardware')).expect(
      200,
    );
    expect(res.body).toEqual(info);
  });

  it('pull: 202 con estado, validación del modelo y consulta de progreso', async () => {
    ollama.startPull.mockReturnValue({
      modelo: 'qwen2.5vl:3b',
      estado: 'descargando',
      completado: 0,
      total: 0,
    });
    const res = await authed(http().post('/api/settings/ia/ollama/pull'))
      .send({ modelo: 'qwen2.5vl:3b' })
      .expect(202);
    expect(res.body).toEqual({ modelo: 'qwen2.5vl:3b', estado: 'descargando' });
    expect(ollama.startPull).toHaveBeenCalledWith(
      expect.stringContaining('http'),
      'qwen2.5vl:3b',
    );

    await authed(http().post('/api/settings/ia/ollama/pull'))
      .send({ modelo: 'a b; rm' })
      .expect(400);
    await authed(http().get('/api/settings/ia/ollama/pull')).expect(400);

    ollama.status.mockReturnValue({
      modelo: 'qwen2.5vl:3b',
      estado: 'descargando',
      completado: 5,
      total: 10,
    });
    const st = await authed(
      http().get('/api/settings/ia/ollama/pull?modelo=qwen2.5vl:3b'),
    ).expect(200);
    expect(st.body).toMatchObject({ completado: 5, total: 10 });
  });

  it('Origin ajeno en rutas mutantes -> 403', async () => {
    const evil = 'http://evil.example';
    await authed(http().put('/api/settings/ia'))
      .set('Origin', evil)
      .send({ bienvenidaCompletada: true })
      .expect(403);
    await authed(http().post('/api/settings/ia/test'))
      .set('Origin', evil)
      .send({})
      .expect(403);
    await authed(http().post('/api/settings/ia/ollama/pull'))
      .set('Origin', evil)
      .send({ modelo: 'm' })
      .expect(403);
    expect(db.setting.rows).toHaveLength(0);
  });
});
