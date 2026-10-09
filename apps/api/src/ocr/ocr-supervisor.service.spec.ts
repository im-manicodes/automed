import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { LogBufferService } from '../logs/log-buffer.service';
import { OcrSupervisorService } from './ocr-supervisor.service';

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: jest.Mock;
};

class Supervisor extends OcrSupervisorService {
  children: FakeChild[] = [];
  calls: {
    cmd: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
  }[] = [];
  protected spawnProcess(
    cmd: string,
    args: string[],
    opts: { cwd: string; env: NodeJS.ProcessEnv },
  ) {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = jest.fn(() => {
      setImmediate(() => child.emit('exit', null, 'SIGTERM'));
      return true;
    });
    this.children.push(child);
    this.calls.push({ cmd, args, ...opts });
    return child as never;
  }
}

describe('OcrSupervisorService', () => {
  let home: string;
  let buffer: LogBufferService;
  const make = (env: Record<string, string> = {}) =>
    new Supervisor(
      { get: (k: string) => ({ OCR_HOME: home, ...env })[k] } as never,
      buffer,
    );
  const install = () => {
    mkdirSync(join(home, 'venv', 'bin'), { recursive: true });
    writeFileSync(join(home, 'venv', 'bin', 'python'), '');
    mkdirSync(join(home, 'ocr-local', 'app'), { recursive: true });
    writeFileSync(join(home, 'ocr-local', 'app', 'main.py'), '');
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ocr-sup-'));
    buffer = new LogBufferService();
  });
  afterEach(() => {
    jest.useRealTimers();
    rmSync(home, { recursive: true, force: true });
  });

  it('sin instalar no arranca', () => {
    const s = make();
    expect(s.isInstalled()).toBe(false);
    expect(() => s.start()).toThrow(/no está instalado/);
  });

  it('servicio externo: no gestiona', () => {
    install();
    const s = make({ OCR_LOCAL_URL: 'http://ocr-local:8000' });
    expect(s.managed).toBe(false);
    expect(() => s.start()).toThrow(/externo/);
  });

  it('arranca uvicorn en 127.0.0.1:8000 con args fijos, registra la salida y es idempotente', async () => {
    install();
    const s = make();
    s.start();
    s.start();
    expect(s.calls).toHaveLength(1);
    const c = s.calls[0];
    expect(c.cmd).toBe(join(home, 'venv', 'bin', 'python'));
    expect(c.args).toEqual([
      '-m',
      'uvicorn',
      'app.main:app',
      '--host',
      '127.0.0.1',
      '--port',
      '8000',
      '--no-access-log',
    ]);
    expect(c.cwd).toBe(join(home, 'ocr-local'));
    expect(c.env.JWT_SECRET).toBeUndefined();
    expect(s.status().proceso).toBe('iniciando');
    s.markHealthy();
    expect(s.status().proceso).toBe('en-marcha');
    s.children[0].stderr.write('INFO: Uvicorn running\n');
    await new Promise((r) => setImmediate(r));
    expect(buffer.tail('ocr-local').map((e) => e.mensaje)).toContain(
      'INFO: Uvicorn running',
    );
    await s.stop();
    expect(s.children[0].kill).toHaveBeenCalledWith('SIGTERM');
    expect(s.status().proceso).toBe('detenido');
  });

  it('reinicia con backoff si se cae y se rinde tras varios fallos', () => {
    jest.useFakeTimers();
    install();
    const s = make();
    s.start();
    s.children[0].emit('exit', 1, null);
    expect(s.status()).toMatchObject({ proceso: 'iniciando', reinicios: 1 });
    expect(s.children).toHaveLength(1);
    jest.advanceTimersByTime(1000);
    expect(s.children).toHaveLength(2);
    s.children[1].emit('exit', 1, null);
    jest.advanceTimersByTime(1999);
    expect(s.children).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(s.children).toHaveLength(3);
    for (let i = 0; i < 10; i++) {
      s.children[s.children.length - 1].emit('exit', 1, null);
      jest.advanceTimersByTime(60_000);
    }
    expect(s.status().proceso).toBe('error');
    expect(s.status().ultimoError).toMatch(/terminó/);
  });

  it('onModuleDestroy mata el proceso y no lo reinicia', async () => {
    install();
    const s = make();
    s.start();
    await s.onModuleDestroy();
    expect(s.children[0].kill).toHaveBeenCalled();
    expect(s.children).toHaveLength(1);
    expect(s.status().proceso).toBe('detenido');
  });
});
