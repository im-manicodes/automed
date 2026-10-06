import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp } from '../src/app.setup';
import { SessionGuard } from '../src/auth/session.guard';
import { EventsController } from '../src/events/events.controller';
import { EventsService } from '../src/events/events.service';

describe('Eventos (e2e HTTP, servicio simulado)', () => {
  let app: INestApplication<App>;
  const svc = {
    draft: jest
      .fn()
      .mockResolvedValue({ synthesisId: 's1', yaRegistrado: null }),
    create: jest.fn().mockResolvedValue({ id: 'e1' }),
    list: jest.fn().mockResolvedValue({ eventos: [], synthesisId: null }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  let allow = true;
  const origin = 'http://localhost:8080';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [{ provide: EventsService, useValue: svc }],
    })
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: () => allow })
      .compile();
    app = mod.createNestApplication({ bodyParser: false });
    configureApp(app, origin);
    await app.init();
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  it('exige sesión', async () => {
    allow = false;
    await http().get('/api/threads/t1/events').expect(403);
    allow = true;
    await http().get('/api/threads/t1/events').expect(200);
  });

  it('POST event-draft: 200, errores propagados, Origin y JSON', async () => {
    const ok = await http().post('/api/threads/t1/event-draft').expect(200);
    expect(ok.body.synthesisId).toBe('s1');
    svc.draft.mockRejectedValueOnce(new NotFoundException('x'));
    await http().post('/api/threads/zz/event-draft').expect(404);
    svc.draft.mockRejectedValueOnce(new ConflictException('x'));
    await http().post('/api/threads/t1/event-draft').expect(409);
    svc.draft.mockRejectedValueOnce(new ServiceUnavailableException('x'));
    await http().post('/api/threads/t1/event-draft').expect(503);
    await http()
      .post('/api/threads/t1/event-draft')
      .set('Origin', 'http://evil.test')
      .expect(403);
  });

  it('POST events: 201, valida Origin y Content-Type, propaga 409', async () => {
    const payload = {
      synthesisId: 's1',
      datos: {},
      estado: 'alta',
      fechaEvento: '2026-10-01',
    };
    const r = await http()
      .post('/api/threads/t1/events')
      .set('Origin', origin)
      .send(payload)
      .expect(201);
    expect(r.body.id).toBe('e1');
    expect(svc.create).toHaveBeenCalledWith('t1', payload);
    await http()
      .post('/api/threads/t1/events')
      .set('Origin', 'http://evil.test')
      .send(payload)
      .expect(403);
    await http()
      .post('/api/threads/t1/events')
      .set('Content-Type', 'text/plain')
      .send('x')
      .expect(415);
    svc.create.mockRejectedValueOnce(new ConflictException('x'));
    await http().post('/api/threads/t1/events').send(payload).expect(409);
  });

  it('GET events y DELETE events/:id (204, 404, Origin)', async () => {
    const l = await http().get('/api/threads/t1/events').expect(200);
    expect(l.body).toEqual({ eventos: [], synthesisId: null });
    await http().delete('/api/events/e1').expect(204);
    expect(svc.remove).toHaveBeenCalledWith('e1');
    await http()
      .delete('/api/events/e1')
      .set('Origin', 'http://evil.test')
      .expect(403);
    svc.remove.mockRejectedValueOnce(new NotFoundException('x'));
    await http().delete('/api/events/zz').expect(404);
  });
});
