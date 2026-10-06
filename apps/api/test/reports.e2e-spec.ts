import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import {
  ConflictException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp } from '../src/app.setup';
import { SessionGuard } from '../src/auth/session.guard';
import { ReportsController } from '../src/reports/reports.controller';
import { ReportsService } from '../src/reports/reports.service';

describe('Reportes (e2e HTTP, servicio simulado)', () => {
  let app: INestApplication<App>;
  const svc = {
    list: jest.fn().mockResolvedValue({ reportes: [] }),
    createManual: jest.fn().mockResolvedValue({
      reporte: { id: 'r1', status: 'generando' },
      reutilizado: false,
    }),
    getSettings: jest.fn().mockResolvedValue({
      programado: false,
      hora: '07:00',
      zona: 'America/Mexico_City',
    }),
    updateSettings: jest.fn((b) =>
      Promise.resolve({
        programado: true,
        hora: '07:00',
        zona: 'America/Mexico_City',
        ...b,
      }),
    ),
    detail: jest.fn(),
    download: jest.fn(),
  };
  let allow = true;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: svc }],
    })
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: () => allow })
      .compile();
    app = mod.createNestApplication({ bodyParser: false });
    configureApp(app, 'http://localhost:8080');
    await app.init();
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  it('exige sesión (403 del guard simulado cuando no hay)', async () => {
    allow = false;
    await http().get('/api/reports').expect(403);
    allow = true;
    await http().get('/api/reports').expect(200);
  });

  it('POST /api/reports responde 202 y valida Origin y JSON como el resto', async () => {
    const r = await http().post('/api/reports').expect(202);
    expect(r.body.reporte.id).toBe('r1');
    await http()
      .post('/api/reports')
      .set('Origin', 'http://evil.test')
      .expect(403);
    await http()
      .post('/api/reports')
      .set('Content-Type', 'text/plain')
      .send('x')
      .expect(415);
  });

  it('GET|PUT /api/reports/settings no se confunde con :id', async () => {
    await http().get('/api/reports/settings').expect(200);
    const r = await http()
      .put('/api/reports/settings')
      .set('Origin', 'http://localhost:8080')
      .send({ programado: true })
      .expect(200);
    expect(r.body.programado).toBe(true);
    expect(svc.detail).not.toHaveBeenCalled();
  });

  it('GET /api/reports/:id y /download propagan 404/409 y entregan el xlsx', async () => {
    svc.detail.mockRejectedValueOnce(
      new NotFoundException('Reporte no encontrado'),
    );
    await http().get('/api/reports/x').expect(404);
    svc.download.mockRejectedValueOnce(new ConflictException('no listo'));
    await http().get('/api/reports/r1/download').expect(409);
    svc.download.mockRejectedValueOnce(new NotFoundException('sin archivo'));
    await http().get('/api/reports/r1/download').expect(404);
    svc.download.mockResolvedValueOnce(
      new StreamableFile(Buffer.from('xlsx'), {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        disposition: 'attachment; filename="reporte.xlsx"',
      }),
    );
    const ok = await http().get('/api/reports/r1/download').expect(200);
    expect(ok.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(ok.headers['content-disposition']).toBe(
      'attachment; filename="reporte.xlsx"',
    );
  });
});
