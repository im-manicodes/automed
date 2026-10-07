import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp, serveFrontend } from '../src/app.setup';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

/** La API sirve el front compilado (imagen única) sin pisar /api. */
describe('serveFrontend (e2e, sin BD)', () => {
  let app: INestApplication<App>;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'front-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<html>app</html>');
    writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    writeFileSync(join(dir, 'sw.js'), '// sw');
    const mod = await Test.createTestingModule({
      controllers: [PingController],
    }).compile();
    app = mod.createNestApplication({ bodyParser: false });
    serveFrontend(app, dir);
    configureApp(app, 'http://localhost:8080');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('sirve index.html en / y en rutas del router, sin CSP de la API', async () => {
    for (const path of ['/', '/tickets/abc/revision/x']) {
      const res = await request(app.getHttpServer()).get(path).expect(200);
      expect(res.text).toContain('app');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toBeUndefined();
    }
  });

  it('assets con hash: caché larga; sw.js: se revalida', async () => {
    const asset = await request(app.getHttpServer())
      .get('/assets/app-abc123.js')
      .expect(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    const sw = await request(app.getHttpServer()).get('/sw.js').expect(200);
    expect(sw.headers['cache-control']).toBe('no-cache');
  });

  it('/api sigue siendo de la API (con su CSP) y un /api inexistente no cae en index.html', async () => {
    const ok = await request(app.getHttpServer()).get('/api/ping').expect(200);
    expect(ok.body).toEqual({ ok: true });
    expect(ok.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    const nf = await request(app.getHttpServer()).get('/api/nada').expect(404);
    expect(nf.text).not.toContain('<html>');
  });

  it('falla al arrancar si la carpeta no tiene index.html', () => {
    expect(() => serveFrontend(app, join(dir, 'assets'))).toThrow(
      /sin index.html/,
    );
  });
});
