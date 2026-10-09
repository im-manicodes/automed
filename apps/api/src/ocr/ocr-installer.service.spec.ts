import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { ConflictException } from '@nestjs/common';
import { LogBufferService } from '../logs/log-buffer.service';
import { OCR_INSTALL_KEY, OcrInstallerService } from './ocr-installer.service';
import { OPENCV_HEADLESS, PYTHON_VERSION } from './ocr-local-paths';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require('node:child_process') as { spawn: jest.Mock };

const FAKE_PY = Buffer.from('python-autonomo-falso');
const FAKE_SHA = createHash('sha256').update(FAKE_PY).digest('hex');

/** Simula los procesos: crea en disco lo que crearían tar/venv y responde con `code`. */
function fakeSpawn(fail?: (cmd: string, args: string[]) => number | null) {
  spawn.mockImplementation((cmd: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setImmediate(() => {
      if (cmd === 'tar' && args[0] === '-xzf') {
        const dest = args[args.indexOf('-C') + 1];
        if (args[1].endsWith('python.tar.gz.tmp')) {
          mkdirSync(join(dest, 'python', 'bin'), { recursive: true });
          writeFileSync(join(dest, 'python', 'bin', 'python3'), '');
        } else {
          mkdirSync(join(dest, 'app'), { recursive: true });
          writeFileSync(join(dest, 'app', 'main.py'), '');
          writeFileSync(join(dest, 'requirements.txt'), 'paddleocr==3.0.3\n');
        }
      }
      if (args[0] === '-m' && args[1] === 'venv') {
        mkdirSync(join(args[2], 'bin'), { recursive: true });
        writeFileSync(join(args[2], 'bin', 'python'), '');
      }
      if (args.includes('-r')) {
        child.stdout.write('Collecting paddleocr==3.0.3\n');
        child.stdout.write('token=abc123 secreto\n');
      }
      const code = fail?.(cmd, args) ?? 0;
      if (code !== 0)
        child.stderr.write('ImportError: libgomp.so.1: cannot open\n');
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', code));
    });
    return child;
  });
}

class Installer extends OcrInstallerService {
  free = 50 * 1024 ** 3;
  warm = jest.fn(async () => undefined);
  downloaded = 0;
  protected pythonDownload() {
    return { url: 'https://example.invalid/python.tgz', sha256: FAKE_SHA };
  }
  protected async download(_url: string, dest: string) {
    this.downloaded++;
    writeFileSync(dest, FAKE_PY);
  }
  protected async freeBytes() {
    return this.free;
  }
  protected warmup() {
    return this.warm();
  }
  protected capture() {
    return Promise.resolve(Buffer.from('paddleocr==3.0.3\n'));
  }
}

function fakePrisma() {
  const rows = new Map<string, unknown>();
  return {
    rows,
    setting: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
        rows.has(where.key)
          ? { key: where.key, value: rows.get(where.key) }
          : null,
      ),
      upsert: jest.fn(
        async ({
          where,
          update,
        }: {
          where: { key: string };
          update: { value: unknown };
        }) => {
          rows.set(where.key, update.value);
          return { key: where.key, value: update.value };
        },
      ),
    },
  };
}

describe('OcrInstallerService', () => {
  let home: string;
  let asset: string;
  let prisma: ReturnType<typeof fakePrisma>;
  let buffer: LogBufferService;
  let supervisor: {
    start: jest.Mock;
    stop: jest.Mock;
    isInstalled: jest.Mock;
    status: jest.Mock;
    markHealthy: jest.Mock;
  };

  const make = (env: Record<string, string> = {}) =>
    new Installer(
      {
        get: (k: string) =>
          ({ OCR_HOME: home, OCR_ASSET_PATH: asset, ...env })[k],
      } as never,
      prisma as never,
      supervisor as never,
      buffer,
    );

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ocr-home-'));
    asset = join(mkdtempSync(join(tmpdir(), 'ocr-asset-')), 'ocr-local.tgz');
    writeFileSync(asset, 'tgz');
    prisma = fakePrisma();
    buffer = new LogBufferService();
    supervisor = {
      start: jest.fn(),
      stop: jest.fn(async () => undefined),
      isInstalled: jest.fn(() => true),
      status: jest.fn(() => ({
        proceso: 'detenido',
        reinicios: 0,
        ultimoError: null,
      })),
      markHealthy: jest.fn(),
    };
    spawn.mockReset();
    fakeSpawn();
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(join(asset, '..'), { recursive: true, force: true });
  });

  it('instala de punta a punta con comandos fijos y queda listo', async () => {
    const inst = make();
    const first = await inst.install();
    expect(first).toMatchObject({ estado: 'instalando', progreso: 1 });
    expect(inst.busy).toBe(true);
    await inst.waitIdle();

    const st = await inst.getState();
    expect(st).toMatchObject({
      estado: 'listo',
      progreso: 100,
      pythonVersion: PYTHON_VERSION,
      error: null,
    });
    expect(st.requirementsSha).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.rows.get(OCR_INSTALL_KEY)).toMatchObject({ estado: 'listo' });
    expect(existsSync(join(home, 'venv', 'bin', 'python'))).toBe(true);
    expect(existsSync(join(home, 'venv.tmp'))).toBe(false);
    expect(existsSync(join(home, 'python', '.automed-version'))).toBe(true);

    const calls = spawn.mock.calls.map(([c, a]: [string, string[]]) => [
      c.replace(home, '<home>'),
      a.map((x) => x.replace(home, '<home>')),
    ]);
    expect(calls).toEqual([
      ['tar', ['-xzf', '<home>/python.tar.gz.tmp', '-C', '<home>/python.tmp']],
      ['tar', ['-xzf', asset, '-C', '<home>/ocr-local.tmp']],
      ['<home>/python/bin/python3', ['-m', 'venv', '<home>/venv.tmp']],
      [
        '<home>/venv.tmp/bin/python',
        ['-m', 'pip', 'install', '--upgrade', 'pip'],
      ],
      [
        '<home>/venv.tmp/bin/python',
        ['-m', 'pip', 'install', '-r', '<home>/ocr-local/requirements.txt'],
      ],
      [
        '<home>/venv.tmp/bin/python',
        expect.arrayContaining(['uninstall', '-y', 'opencv-contrib-python']),
      ],
      ['<home>/venv.tmp/bin/python', ['-m', 'pip', 'install', OPENCV_HEADLESS]],
      ['<home>/venv.tmp/bin/python', ['-c', 'import cv2, paddle, paddleocr']],
    ]);
    // Entorno mínimo: nunca se hereda process.env (secretos).
    const env = spawn.mock.calls[2][2].env as Record<string, string>;
    expect(env.OCR_FALLBACK).toBe('false');
    expect(env.PADDLE_PDX_CACHE_HOME).toBe(home);
    expect(Object.keys(env)).not.toContain('JWT_SECRET');
    expect(Object.keys(env)).not.toContain('DATABASE_URL');

    expect(supervisor.stop).toHaveBeenCalled();
    expect(supervisor.start).toHaveBeenCalledTimes(1);
    expect(inst.warm).toHaveBeenCalledTimes(1);

    const lines = buffer.tail('ocr-install', 200).map((e) => e.mensaje);
    expect(lines).toContain('Collecting paddleocr==3.0.3');
    expect(lines.join('\n')).not.toMatch(/abc123/);

    const view = await inst.view();
    expect(view).toMatchObject({
      gestionado: true,
      estado: 'listo',
      desactualizado: false,
      requisitos: { internet: true },
    });
    expect(view.lineas.length).toBeGreaterThan(0);
  });

  it('una sola instalación a la vez (409)', async () => {
    const inst = make();
    await inst.install();
    await expect(inst.install()).rejects.toBeInstanceOf(ConflictException);
    await expect(inst.uninstall()).rejects.toBeInstanceOf(ConflictException);
    await inst.waitIdle();
  });

  it('reutiliza Python si ya está la versión fijada', async () => {
    mkdirSync(join(home, 'python', 'bin'), { recursive: true });
    writeFileSync(join(home, 'python', 'bin', 'python3'), '');
    writeFileSync(join(home, 'python', '.automed-version'), PYTHON_VERSION);
    const inst = make();
    await inst.install();
    await inst.waitIdle();
    expect(inst.downloaded).toBe(0);
    expect((await inst.getState()).estado).toBe('listo');
  });

  it('sha256 distinto: error claro y sin venv', async () => {
    const inst = make();
    (inst as unknown as { pythonDownload: () => unknown }).pythonDownload =
      () => ({ url: 'x', sha256: '0'.repeat(64) });
    await inst.install();
    await inst.waitIdle();
    const st = await inst.getState();
    expect(st.estado).toBe('error');
    expect(st.error).toMatch(/huella no coincide/);
    expect(existsSync(join(home, 'venv'))).toBe(false);
  });

  it('sin espacio: no instala nada', async () => {
    const inst = make();
    inst.free = 1024 ** 3;
    await inst.install();
    await inst.waitIdle();
    const st = await inst.getState();
    expect(st.estado).toBe('error');
    expect(st.error).toMatch(/espacio suficiente/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('falta una librería del sistema: lo informa y borra el venv temporal', async () => {
    fakeSpawn((_c, a) => (a[0] === '-c' ? 1 : null));
    const inst = make();
    await inst.install();
    await inst.waitIdle();
    const st = await inst.getState();
    expect(st.estado).toBe('error');
    expect(st.error).toMatch(/libgomp\.so\.1/);
    expect(existsSync(join(home, 'venv.tmp'))).toBe(false);
    expect(existsSync(join(home, 'venv'))).toBe(false);
  });

  it('pip falla: estado error genérico', async () => {
    fakeSpawn((_c, a) => (a.includes('-r') ? 1 : null));
    const inst = make();
    await inst.install();
    await inst.waitIdle();
    expect(await inst.getState()).toMatchObject({
      estado: 'error',
      error: expect.stringMatching(/La instalación falló/),
    });
  });

  it('servicio externo (OCR_LOCAL_URL de otro host): no gestiona nada', async () => {
    const inst = make({ OCR_LOCAL_URL: 'http://ocr-local:8000' });
    expect(inst.managed).toBe(false);
    await expect(inst.install()).rejects.toBeInstanceOf(ConflictException);
    expect(() => inst.startService()).toThrow(ConflictException);
    await inst.onApplicationBootstrap();
    expect(supervisor.start).not.toHaveBeenCalled();
    expect((await inst.view()).gestionado).toBe(false);
  });

  it('al arrancar: instalación interrumpida -> error; listo -> auto-arranque', async () => {
    prisma.rows.set(OCR_INSTALL_KEY, { estado: 'instalando', progreso: 40 });
    const a = make();
    await a.onApplicationBootstrap();
    expect((await a.getState()).estado).toBe('error');
    expect(supervisor.start).not.toHaveBeenCalled();

    prisma.rows.set(OCR_INSTALL_KEY, { estado: 'listo', progreso: 100 });
    const b = make();
    await b.onApplicationBootstrap();
    expect(supervisor.start).toHaveBeenCalledTimes(1);

    supervisor.isInstalled.mockReturnValue(false);
    const c = make();
    await c.onApplicationBootstrap();
    expect((await c.getState()).estado).toBe('no-instalado');
  });

  it('desinstalar detiene y borra python/venv/código, conserva modelos', async () => {
    for (const d of ['python', 'venv', 'ocr-local', 'official_models']) {
      mkdirSync(join(home, d), { recursive: true });
    }
    const inst = make();
    const st = await inst.uninstall();
    expect(st.estado).toBe('no-instalado');
    expect(supervisor.stop).toHaveBeenCalled();
    expect(existsSync(join(home, 'venv'))).toBe(false);
    expect(existsSync(join(home, 'python'))).toBe(false);
    expect(existsSync(join(home, 'ocr-local'))).toBe(false);
    expect(existsSync(join(home, 'official_models'))).toBe(true);
  });

  it('desactualizado si cambia el requirements empaquetado', async () => {
    prisma.rows.set(OCR_INSTALL_KEY, {
      estado: 'listo',
      requirementsSha: 'viejo',
      pythonVersion: PYTHON_VERSION,
    });
    expect((await make().view()).desactualizado).toBe(true);
  });
});
