import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { configureApp } from '../src/app.setup';
import { SessionGuard } from '../src/auth/session.guard';
import { TemplatesController } from '../src/templates/templates.controller';
import { TemplatesService } from '../src/templates/templates.service';
import { TemplateInstructionsService } from '../src/templates/template-instructions.service';
import { DEFAULT_INSTRUCCIONES } from '../src/templates/template-instructions';
import { PrismaService } from '../src/prisma/prisma.service';
import { fakePrisma } from './helpers/fake-prisma';

/** e2e HTTP sin BD: instrucciones de ámbito por plantilla (controlador y servicio reales). */
describe('Plantillas: instrucciones (e2e, sin BD)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  const tpl = {
    getActive: jest.fn(),
    updateActive: jest.fn(),
  };
  const cookie = () =>
    `am_access=${jwt.sign({ email: 'yo@x.com', nombre: 'Yo' }, { subject: 'u1', audience: 'access' })}`;
  const http = () => request(app.getHttpServer());
  const WEB = 'http://localhost:8080';

  beforeEach(async () => {
    tpl.getActive
      .mockReset()
      .mockResolvedValue({ id: 't', version: 1, markdown: '## A' });
    tpl.updateActive
      .mockReset()
      .mockResolvedValue({ id: 't2', version: 2, markdown: '## B' });
    const mod = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 's'.repeat(48) })],
      controllers: [TemplatesController],
      providers: [
        SessionGuard,
        TemplateInstructionsService,
        { provide: TemplatesService, useValue: tpl },
        { provide: PrismaService, useValue: fakePrisma() },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string, def?: unknown) =>
              ({ WEB_ORIGIN: WEB, TOKEN_ENC_KEY: 'x' })[k] ?? def,
          },
        },
      ],
    })
      .useMocker(() => ({}))
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    configureApp(app, WEB);
    await app.init();
    jwt = mod.get(JwtService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET devuelve la plantilla con instrucciones efectivas y por defecto', async () => {
    const res = await http()
      .get('/api/templates/active?kind=whatsapp')
      .set('Cookie', cookie())
      .expect(200);
    expect(res.body).toMatchObject({
      markdown: '## A',
      instrucciones: DEFAULT_INSTRUCCIONES.whatsapp,
      instruccionesPorDefecto: DEFAULT_INSTRUCCIONES.whatsapp,
    });
  });

  it('PUT solo con instrucciones NO crea versión y persiste; null restablece; "" = sin instrucciones', async () => {
    const put = (body: object) =>
      http()
        .put('/api/templates/active?kind=resumen')
        .set('Cookie', cookie())
        .set('Origin', WEB)
        .send(body);
    const r1 = await put({ instrucciones: 'Solo cardiología' }).expect(200);
    expect(r1.body.instrucciones).toBe('Solo cardiología');
    expect(tpl.updateActive).not.toHaveBeenCalled();
    const g = await http()
      .get('/api/templates/active?kind=resumen')
      .set('Cookie', cookie());
    expect(g.body.instrucciones).toBe('Solo cardiología');
    const otro = await http()
      .get('/api/templates/active?kind=reporte')
      .set('Cookie', cookie());
    expect(otro.body.instrucciones).toBe(DEFAULT_INSTRUCCIONES.reporte);

    const r2 = await put({ instrucciones: '' }).expect(200);
    expect(r2.body.instrucciones).toBe('');
    const r3 = await put({ instrucciones: null }).expect(200);
    expect(r3.body.instrucciones).toBe(DEFAULT_INSTRUCCIONES.resumen);
  });

  it('PUT con markdown crea versión y también guarda instrucciones', async () => {
    const res = await http()
      .put('/api/templates/active?kind=resumen')
      .set('Cookie', cookie())
      .set('Origin', WEB)
      .send({ markdown: '## B', instrucciones: 'X' })
      .expect(200);
    expect(tpl.updateActive).toHaveBeenCalledWith('resumen', '## B', undefined);
    expect(res.body).toMatchObject({ version: 2, instrucciones: 'X' });
  });

  it('PUT sin nada o con instrucciones demasiado largas -> 400 en español', async () => {
    const put = (body: object) =>
      http()
        .put('/api/templates/active')
        .set('Cookie', cookie())
        .set('Origin', WEB)
        .send(body);
    const a = await put({}).expect(400);
    expect(JSON.stringify(a.body.message)).toMatch(/instrucciones/);
    const b = await put({ instrucciones: 'x'.repeat(4001) }).expect(400);
    expect(JSON.stringify(b.body.message)).toMatch(/4000 caracteres/);
  });
});
