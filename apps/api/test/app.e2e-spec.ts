import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { configureApp } from '../src/app.setup';
import { SessionService } from '../src/auth/session.service';
import { SessionGuard } from '../src/auth/session.guard';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { ThreadsController } from '../src/threads/threads.controller';
import { TemplatesController } from '../src/templates/templates.controller';
import { TemplatesService } from '../src/templates/templates.service';
import { MailController } from '../src/mail/mail.controller';
import { JobsController } from '../src/jobs/jobs.controller';
import { AttachmentsController } from '../src/attachments/attachments.controller';
import { OcrRegionsController } from '../src/review/ocr-regions.controller';
import { SynthesisController } from '../src/synthesis/synthesis.controller';

/** e2e HTTP sin BD ni red: controladores reales, servicios simulados. */
describe('API (e2e, sin BD)', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const config = {
    get: (k: string, def?: unknown) =>
      ({
        TOKEN_ENC_KEY: 'clave-de-prueba',
        WEB_ORIGIN: 'http://localhost:8080',
      })[k] ?? def,
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [
        AppController,
        AuthController,
        ThreadsController,
        TemplatesController,
        MailController,
        JobsController,
        AttachmentsController,
        OcrRegionsController,
        SynthesisController,
      ],
      providers: [
        AppService,
        SessionService,
        SessionGuard,
        { provide: ConfigService, useValue: config },
        {
          provide: AuthService,
          useValue: { buildLoginUrl: () => 'https://login.example/authorize' },
        },
        {
          provide: TemplatesService,
          useValue: { getActive: () => Promise.resolve({ name: 'x' }) },
        },
      ],
    })
      .useMocker((token) => {
        if (token === AppService) return;
        return {};
      })
      .overrideProvider(AppService)
      .useValue({
        health: () =>
          Promise.resolve({ status: 'ok', db: true, storage: true }),
      })
      .compile();
    app = mod.createNestApplication();
    configureApp(app, 'http://localhost:8080');
    await app.init();
    sessions = mod.get(SessionService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health es público', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(res.body).toEqual({ status: 'ok', db: true, storage: true });
    expect(res.headers['x-content-type-options']).toBe('nosniff'); // helmet
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('GET /api/auth/me sin sesión no falla y dice authenticated=false', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  it('GET /api/auth/login redirige a Microsoft (público)', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/login')
      .expect(302)
      .expect('Location', 'https://login.example/authorize');
  });

  it.each([
    ['get', '/api/threads'],
    ['post', '/api/threads/analyze'],
    ['post', '/api/threads/abc/analyze'],
    ['patch', '/api/threads/abc/seguimiento'],
    ['get', '/api/templates/active'],
    ['put', '/api/templates/active'],
    ['post', '/api/templates/reset'],
    ['post', '/api/templates/preview'],
    ['post', '/api/mail/sync'],
    ['get', '/api/mail/status'],
    ['get', '/api/jobs/status'],
    ['get', '/api/attachments/abc/pages'],
    ['get', '/api/attachments/abc/pages/1/image'],
    ['patch', '/api/ocr/regions/abc'],
    ['get', '/api/threads/abc/synthesis'],
  ] as const)('%s %s sin sesión -> 401', async (method, path) => {
    await request(app.getHttpServer())[method](path).expect(401);
  });

  it('con sesión válida pasa el guard (200)', async () => {
    const cookie = `am_session=${sessions.create('yo@x.com')}`;
    await request(app.getHttpServer())
      .get('/api/templates/active')
      .set('Cookie', cookie)
      .expect(200);
  });

  it('una cookie falsificada no pasa', async () => {
    await request(app.getHttpServer())
      .get('/api/templates/active')
      .set('Cookie', 'am_session=abc.def')
      .expect(401);
  });

  it('cuerpos JSON mayores a 256kb se rechazan (413)', async () => {
    const cookie = `am_session=${sessions.create('yo@x.com')}`;
    await request(app.getHttpServer())
      .put('/api/templates/active')
      .set('Cookie', cookie)
      .send({ markdown: 'x'.repeat(300_000) })
      .expect(413);
  });
});
