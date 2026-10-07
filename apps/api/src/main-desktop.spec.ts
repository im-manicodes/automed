import { Controller, Get, Module } from '@nestjs/common';
import { buildDesktopEnv, startServer } from './main-desktop';

@Controller('health')
class HealthCtrl {
  @Get()
  ok() {
    return { ok: true };
  }
}
@Module({ controllers: [HealthCtrl] })
class FakeAppModule {}

jest.mock('./app.module', () => ({
  get AppModule() {
    return FakeAppModule;
  },
}));

describe('modo escritorio', () => {
  it('buildDesktopEnv fija el entorno esperado y respeta lo de Electron', () => {
    const env = buildDesktopEnv(
      {
        port: 4567,
        dataDir: '/tmp/datos',
        env: { JWT_SECRET: 'x', WEB_ORIGIN: 'http://otro' },
      },
      { PATH: '/bin', STORAGE_DRIVER: 's3' },
    );
    expect(env).toMatchObject({
      APP_MODE: 'desktop',
      STORAGE_DRIVER: 'fs',
      DATA_DIR: '/tmp/datos',
      PORT: '4567',
      WEB_ORIGIN: 'http://localhost:4567',
      COOKIE_SECURE: 'false',
      PDF_TEXT_MODE: 'node',
      JWT_SECRET: 'x',
    });
  });

  it('PDF_TEXT_MODE recibido tiene prioridad sobre el valor por defecto', () => {
    const env = buildDesktopEnv(
      { port: 1, dataDir: '/d', env: { PDF_TEXT_MODE: 'off' } },
      {},
    );
    expect(env.PDF_TEXT_MODE).toBe('off');
  });

  it('startServer escucha en 127.0.0.1 bajo /api y se cierra', async () => {
    const saved = { ...process.env };
    try {
      const s = await startServer({ port: 0, dataDir: '/tmp/automed-test' });
      expect(process.env.APP_MODE).toBe('desktop');
      expect(process.env.STORAGE_DRIVER).toBe('fs');
      const res = await fetch(`http://127.0.0.1:${s.port}/api/health`);
      expect(await res.json()).toEqual({ ok: true });
      await s.close();
    } finally {
      process.env = saved;
    }
  });
});
