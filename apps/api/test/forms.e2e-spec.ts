import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp } from '../src/app.setup';
import { SessionGuard } from '../src/auth/session.guard';
import { FormsController } from '../src/forms/forms.controller';
import { FormsService } from '../src/forms/forms.service';

describe('Formatos PDF (e2e HTTP, servicio simulado)', () => {
  let app: INestApplication<App>;
  const svc = {
    listFormats: jest
      .fn()
      .mockReturnValue([{ id: 'ingreso-pemex', titulo: 'x', campos: [] }]),
    draft: jest.fn().mockResolvedValue({
      formato: 'ingreso-pemex',
      valores: {},
      faltantes: [],
      errores: [],
    }),
    getSaved: jest.fn().mockResolvedValue({
      existe: true,
      valores: { a: 'b' },
      desactualizado: false,
      actualizadoEn: '2026-10-12T00:00:00.000Z',
      camposEditados: [],
    }),
    saveEdits: jest
      .fn()
      .mockResolvedValue({ existe: true, valores: { a: 'c' } }),
    preview: jest
      .fn()
      .mockResolvedValue({ paginas: ['data:image/png;base64,AAAA'] }),
    render: jest.fn().mockResolvedValue({
      bytes: new Uint8Array(Buffer.from('%PDF-1.7 fake')),
      filename: 'ingreso-pemex-2026-10-12.pdf',
    }),
  };
  let allow = true;
  const origin = 'http://localhost:8080';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [FormsController],
      providers: [{ provide: FormsService, useValue: svc }],
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

  it('GET /forms exige sesión y lista catálogos', async () => {
    allow = false;
    await http().get('/api/forms').expect(403);
    allow = true;
    const r = await http().get('/api/forms').expect(200);
    expect(r.body[0].id).toBe('ingreso-pemex');
  });

  it('POST form-draft: 200, propaga 400/409 y valida Origin', async () => {
    const r = await http()
      .post('/api/threads/t1/form-draft')
      .send({ formato: 'ingreso-pemex' })
      .expect(200);
    expect(r.body.formato).toBe('ingreso-pemex');
    expect(svc.draft).toHaveBeenCalledWith('t1', 'ingreso-pemex', {
      actualizar: false,
    });
    svc.draft.mockRejectedValueOnce(new BadRequestException('x'));
    await http()
      .post('/api/threads/t1/form-draft')
      .send({ formato: 'zz' })
      .expect(400);
    svc.draft.mockRejectedValueOnce(new ConflictException('x'));
    await http()
      .post('/api/threads/t1/form-draft')
      .send({ formato: 'ingreso-pemex' })
      .expect(409);
    await http()
      .post('/api/threads/t1/form-draft')
      .set('Origin', 'http://evil.test')
      .send({ formato: 'ingreso-pemex' })
      .expect(403);
  });

  it('POST form-draft con actualizar:true lo propaga', async () => {
    await http()
      .post('/api/threads/t1/form-draft')
      .send({ formato: 'ingreso-pemex', actualizar: true })
      .expect(200);
    expect(svc.draft).toHaveBeenLastCalledWith('t1', 'ingreso-pemex', {
      actualizar: true,
    });
  });

  it('GET draft guardado: 200 y propaga 404/400', async () => {
    const r = await http()
      .get('/api/threads/t1/forms/ingreso-pemex/draft')
      .expect(200);
    expect(r.body.existe).toBe(true);
    expect(svc.getSaved).toHaveBeenCalledWith('t1', 'ingreso-pemex');
    svc.getSaved.mockRejectedValueOnce(new NotFoundException('x'));
    await http().get('/api/threads/zz/forms/ingreso-pemex/draft').expect(404);
    svc.getSaved.mockRejectedValueOnce(new BadRequestException('x'));
    await http().get('/api/threads/t1/forms/zz/draft').expect(400);
  });

  it('PUT draft: guarda valores, propaga 400/404 y valida Origin', async () => {
    await http()
      .put('/api/threads/t1/forms/ingreso-pemex/draft')
      .send({ valores: { a: 'c' } })
      .expect(200);
    expect(svc.saveEdits).toHaveBeenCalledWith('t1', 'ingreso-pemex', {
      a: 'c',
    });
    svc.saveEdits.mockRejectedValueOnce(new NotFoundException('x'));
    await http()
      .put('/api/threads/t1/forms/ingreso-pemex/draft')
      .send({ valores: {} })
      .expect(404);
    svc.saveEdits.mockRejectedValueOnce(new BadRequestException('x'));
    await http()
      .put('/api/threads/t1/forms/ingreso-pemex/draft')
      .send({ valores: { a: 1 } })
      .expect(400);
    await http()
      .put('/api/threads/t1/forms/ingreso-pemex/draft')
      .set('Origin', 'http://evil.test')
      .send({ valores: {} })
      .expect(403);
  });

  it('POST pdf: application/pdf, attachment y empieza con %PDF', async () => {
    const r = await http()
      .post('/api/threads/t1/forms/ingreso-pemex/pdf')
      .send({ valores: { a: 'b' } })
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.headers['content-disposition']).toContain('attachment');
    expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect(svc.render).toHaveBeenCalledWith('t1', 'ingreso-pemex', { a: 'b' });
    svc.render.mockRejectedValueOnce(new BadRequestException('x'));
    await http()
      .post('/api/threads/t1/forms/zz/pdf')
      .send({ valores: {} })
      .expect(400);
  });

  it('POST preview: JSON con páginas, propaga 400/404 y valida Origin', async () => {
    const r = await http()
      .post('/api/threads/t1/forms/ingreso-pemex/preview')
      .send({ valores: { a: 'b' } })
      .expect(200);
    expect(r.body.paginas[0]).toMatch(/^data:image\/png;base64,/);
    expect(svc.preview).toHaveBeenCalledWith('t1', 'ingreso-pemex', { a: 'b' });
    svc.preview.mockRejectedValueOnce(new BadRequestException('x'));
    await http()
      .post('/api/threads/t1/forms/ingreso-pemex/preview')
      .send({ valores: { a: 1 } })
      .expect(400);
    svc.preview.mockRejectedValueOnce(new NotFoundException('x'));
    await http()
      .post('/api/threads/zz/forms/ingreso-pemex/preview')
      .send({ valores: {} })
      .expect(404);
    await http()
      .post('/api/threads/t1/forms/ingreso-pemex/preview')
      .set('Origin', 'http://evil.test')
      .send({ valores: {} })
      .expect(403);
  });
});
