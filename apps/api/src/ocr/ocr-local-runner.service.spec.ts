import { OcrLocalRunner } from './ocr-local-runner.service';
import { fakeRunner } from './test-fakes';

const timing = { pollMs: 5, startTimeoutMs: 300, backoffMs: [10, 10] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function make(
  opts: {
    desktop?: boolean;
    motor?: string;
    ready?: boolean;
    health?: jest.Mock;
  } = {},
) {
  const f = fakeRunner(opts.health ? { health: opts.health as never } : {});
  const state = { motor: opts.motor ?? 'local', ready: opts.ready ?? true };
  const env = {
    isReady: jest.fn(() => state.ready),
    onChange: jest.fn(() => () => undefined),
    venvPython: '/data/python/venv/bin/python',
    modelsDir: '/data/python/models',
  };
  const runner = new OcrLocalRunner(
    {
      get: (k: string) =>
        ({
          ...(opts.desktop === false ? {} : { APP_MODE: 'desktop' }),
          OCR_LOCAL_APP_DIR: '/app/ocr-local',
        })[k],
    } as never,
    { getEffective: jest.fn(async () => ({ motor: state.motor })) } as never,
    env as never,
    f.runner,
    timing,
  );
  return {
    runner,
    state,
    env,
    children: f.children,
    spawnCalls: f.spawnCalls,
  };
}

describe('OcrLocalRunner', () => {
  it('arranca uvicorn con puerto libre, cwd y entorno, y espera /health', async () => {
    const { runner, spawnCalls } = make();
    await runner.reconcile();
    expect(spawnCalls[0].cmd).toBe('/data/python/venv/bin/python');
    expect(spawnCalls[0].args).toEqual([
      '-m',
      'uvicorn',
      'app.main:app',
      '--host',
      '127.0.0.1',
      '--port',
      '45678',
    ]);
    expect(spawnCalls[0].opts.cwd).toBe('/app/ocr-local');
    expect(spawnCalls[0].opts.env).toMatchObject({
      PADDLE_PDX_CACHE_HOME: '/data/python/models',
      OCR_LOCAL_ENGINE: 'paddle',
      OCR_LANG: 'es',
    });
    expect(spawnCalls[0].opts.env.JWT_SECRET).toBeUndefined();
    expect(runner.getStatus()).toEqual({
      estado: 'listo',
      fallbackReason: null,
    });
    expect(runner.getUrl()).toBe('http://127.0.0.1:45678');
    runner.stop();
  });

  it('expone fallback_reason del /health', async () => {
    const health = jest
      .fn()
      .mockResolvedValue({ ok: true, fallbackReason: 'ImportError' });
    const { runner } = make({ health });
    await runner.reconcile();
    expect(runner.getStatus().fallbackReason).toBe('ImportError');
    runner.stop();
  });

  it('espera con /health hasta que responde', async () => {
    const health = jest
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true });
    const { runner } = make({ health });
    await runner.reconcile();
    expect(health).toHaveBeenCalledTimes(3);
    expect(runner.getStatus().estado).toBe('listo');
    runner.stop();
  });

  it('no arranca fuera de escritorio, sin entorno listo o con otro motor', async () => {
    for (const o of [
      { desktop: false },
      { ready: false },
      { motor: 'textract' },
    ]) {
      const m = make(o);
      await m.runner.reconcile();
      expect(m.spawnCalls).toHaveLength(0);
      expect(m.runner.getStatus().estado).toBe('detenido');
    }
  });

  it('reinicia con backoff si el proceso cae', async () => {
    const { runner, children, spawnCalls } = make();
    await runner.reconcile();
    children[0].end(1);
    expect(runner.getStatus().estado).toBe('iniciando');
    await sleep(60);
    expect(spawnCalls).toHaveLength(2);
    expect(runner.getStatus().estado).toBe('listo');
    runner.stop();
  });

  it('tras agotar los reinicios queda en error', async () => {
    const holder: { kids: { end(c: number): void }[] } = { kids: [] };
    const health = jest.fn(() => {
      holder.kids.at(-1)?.end(1);
      return Promise.resolve({ ok: false });
    });
    const m = make({ health });
    holder.kids = m.children;
    await m.runner.reconcile();
    await sleep(120);
    expect(m.spawnCalls).toHaveLength(3); // 1 inicial + 2 reinicios
    expect(m.runner.getStatus().estado).toBe('error');
    m.runner.stop();
  });

  it('se detiene al cambiar el motor y al apagar', async () => {
    const { runner, children, state } = make();
    await runner.reconcile();
    state.motor = 'textract';
    await runner.reconcile();
    expect(children[0].killed).toBe(true);
    expect(runner.getStatus().estado).toBe('detenido');
    expect(runner.getUrl()).toBeNull();
    state.motor = 'local';
    await runner.reconcile();
    expect(children).toHaveLength(2);
    runner.onApplicationShutdown();
    expect(children[1].killed).toBe(true);
    await sleep(30);
    expect(children).toHaveLength(2); // la parada voluntaria no reinicia
  });
});
