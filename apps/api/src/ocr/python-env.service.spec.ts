import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConflictException } from '@nestjs/common';
import {
  PYTHON_RANGE,
  PYTHON_REQUIRED,
  PythonEnvService,
  buildGuide,
  mapPrepareError,
} from './python-env.service';
import { fakeRunner } from './test-fakes';

let dir: string;
let req: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pyenv-'));
  req = join(dir, 'requirements.txt');
  writeFileSync(req, 'fastapi\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function make(
  execImpl: (cmd: string, args: string[]) => Promise<any>,
  platform = 'linux',
) {
  const f = fakeRunner({ execFile: jest.fn(execImpl) as never });
  const svc = new PythonEnvService(
    {
      get: (k: string) => ({ DATA_DIR: dir, OCR_LOCAL_REQUIREMENTS: req })[k],
    } as never,
    f.runner,
  );
  svc.platform = platform;
  return { svc, ...f };
}

const ver = (v: string) =>
  Promise.resolve({ stdout: `Python ${v}\n`, stderr: '' });

describe('PythonEnvService.detect', () => {
  it('no instalado: guía y motivo', async () => {
    const { svc } = make(() => Promise.reject(new Error('ENOENT')));
    const d = await svc.detect();
    expect(d).toMatchObject({
      detectado: false,
      compatible: false,
      requerido: PYTHON_REQUIRED,
      rango: PYTHON_RANGE,
    });
    expect(d.motivo).toMatch(/No encontramos Python/);
    expect(d.guia.comandos[0]).toContain('python3.11-venv');
  });

  it('versión menor: detectado pero incompatible', async () => {
    const { svc } = make((cmd, args) =>
      cmd === 'python3' && args[0] === '--version'
        ? ver('3.8.10')
        : Promise.reject(new Error('x')),
    );
    const d = await svc.detect();
    expect(d).toMatchObject({
      detectado: true,
      version: '3.8.10',
      compatible: false,
    });
    expect(d.motivo).toMatch(/antiguo/);
  });

  it('versión mayor: demasiado nueva', async () => {
    const { svc } = make((cmd, args) =>
      cmd === 'python3' && args[0] === '--version'
        ? ver('3.13.1')
        : Promise.reject(new Error('x')),
    );
    expect((await svc.detect()).motivo).toMatch(/nuevo/);
  });

  it('versión compatible (stderr de Python 2.7/3.3 incluido) y ejecutable resuelto', async () => {
    const { svc } = make((cmd, args) => {
      if (cmd === 'python3.11' && args[0] === '--version')
        return Promise.resolve({ stdout: '', stderr: 'Python 3.11.4\n' });
      if (
        cmd === 'python3.11' &&
        args[0] === '-c' &&
        /sys.executable/.test(args[1])
      )
        return Promise.resolve({ stdout: '/usr/bin/python3.11\n', stderr: '' });
      if (args[0] === '-c') return Promise.resolve({ stdout: '', stderr: '' });
      return Promise.reject(new Error('x'));
    });
    const d = await svc.detect();
    expect(d).toMatchObject({
      detectado: true,
      compatible: true,
      version: '3.11.4',
    });
    expect(d.ejecutable).toBe('/usr/bin/python3.11');
  });

  it('sin módulo venv: incompatible con motivo', async () => {
    const { svc } = make((cmd, args) => {
      if (args.includes('--version')) return ver('3.11.2');
      if (args[1] === 'import venv, ensurepip')
        return Promise.reject(new Error('no venv'));
      return Promise.resolve({ stdout: 'python3\n', stderr: '' });
    });
    const d = await svc.detect();
    expect(d.compatible).toBe(false);
    expect(d.motivo).toMatch(/venv/);
    expect(d.guia.pasos[0]).toMatch(/venv/);
  });

  it('Windows usa el lanzador py -3.x', async () => {
    const { svc, runner } = make(
      (cmd, args) =>
        cmd === 'py' && args[0] === '-3.11' && args[1] === '--version'
          ? ver('3.11.9')
          : Promise.resolve({
              stdout: 'C:\\Python311\\python.exe\n',
              stderr: '',
            }),
      'win32',
    );
    const d = await svc.detect();
    expect(d.compatible).toBe(true);
    expect(runner.execFile).toHaveBeenCalledWith('py', ['-3.11', '--version']);
  });
});

describe('guía por sistema', () => {
  it('Windows: python.org, PATH y winget', () => {
    const g = buildGuide('windows');
    expect(g.pasos.join(' ')).toContain('Add python.exe to PATH');
    expect(g.comandos).toContain('winget install Python.Python.3.11');
    expect(g.enlace).toMatch(/python\.org/);
  });
  it('Linux: apt, deadsnakes y pyenv', () => {
    const g = buildGuide('linux');
    expect(g.comandos[0]).toBe('sudo apt install python3.11 python3.11-venv');
    expect(g.comandos.join(' ')).toMatch(/deadsnakes/);
    expect(g.comandos.join(' ')).toMatch(/pyenv/);
  });
});

describe('mapPrepareError', () => {
  it.each([
    ['Temporary failure in name resolution', /internet/],
    ['OSError: [Errno 28] No space left on device', /espacio/],
    [
      'The virtual environment was not created successfully because ensurepip is not available',
      /venv/,
    ],
    ['ERROR: Package requires a different Python: 3.13', /compatible/],
    ['Something odd', /No se pudo preparar/],
  ])('%s', (line, re) => {
    expect(mapPrepareError([line])).toMatch(re);
  });
});

describe('PythonEnvService.prepare', () => {
  const okExec = (cmd: string, args: string[]) =>
    args.includes('--version')
      ? ver('3.11.4')
      : Promise.resolve({ stdout: '/usr/bin/python3.11\n', stderr: '' });

  const flush = () => new Promise((r) => setImmediate(r));

  it('crea el venv, instala y queda listo (con anillo de 50 líneas)', async () => {
    const { svc, children, spawnCalls } = make(okExec);
    expect(svc.entornoEstado().estado).toBe('sin_preparar');
    await expect(svc.prepare()).resolves.toEqual({ estado: 'preparando' });
    expect(svc.entornoEstado().estado).toBe('preparando');
    await flush();
    expect(spawnCalls[0].args).toEqual(['-m', 'venv', svc.venvDir]);
    expect(spawnCalls[0].opts.env.PADDLE_PDX_CACHE_HOME).toBe(svc.modelsDir);
    // simula la creación del venv
    mkdirSync(join(svc.venvDir, 'bin'), { recursive: true });
    writeFileSync(svc.venvPython, '');
    children[0].end(0);
    await flush();
    expect(spawnCalls[1].cmd).toBe(svc.venvPython);
    expect(spawnCalls[1].args).toEqual(['-m', 'pip', 'install', '-r', req]);
    for (let i = 0; i < 80; i++) children[1].out(`Collecting paquete-${i}\n`);
    children[1].end(0);
    await svc.whenIdle();
    const p = svc.progress();
    expect(p.estado).toBe('listo');
    expect(p.lineas.length).toBe(50);
    expect(p.lineas.at(-1)).toMatch(/Listo/);
    expect(svc.isReady()).toBe(true);
    expect(existsSync(join(dir, 'python', '.entorno-listo'))).toBe(true);
  });

  it('es idempotente mientras prepara', async () => {
    const { svc, spawnCalls } = make(okExec);
    await svc.prepare();
    await svc.prepare();
    await flush();
    expect(spawnCalls).toHaveLength(1);
  });

  it('fallo de pip: error legible', async () => {
    const { svc, children } = make(okExec);
    mkdirSync(join(svc.venvDir, 'bin'), { recursive: true });
    writeFileSync(svc.venvPython, '');
    await svc.prepare();
    await flush();
    children[0].err(
      'WARNING: Retrying ... Temporary failure in name resolution\n',
    );
    children[0].end(1);
    await svc.whenIdle();
    expect(svc.progress()).toMatchObject({ estado: 'error' });
    expect(svc.progress().mensaje).toMatch(/internet/);
    expect(svc.entornoEstado().estado).toBe('error');
    expect(svc.isReady()).toBe(false);
  });

  it('falla de venv (no se crea el Python del venv)', async () => {
    const { svc, children } = make(okExec);
    await svc.prepare();
    await flush();
    children[0].err('ensurepip is not available\n');
    children[0].end(1);
    await svc.whenIdle();
    expect(svc.progress().mensaje).toMatch(/venv/);
  });

  it('409 si Python no es compatible', async () => {
    const { svc } = make(() => Promise.reject(new Error('x')));
    await expect(svc.prepare()).rejects.toThrow(ConflictException);
  });

  it('notifica a los oyentes al terminar', async () => {
    const { svc, children } = make(okExec);
    const cb = jest.fn();
    svc.onChange(cb);
    mkdirSync(join(svc.venvDir, 'bin'), { recursive: true });
    writeFileSync(svc.venvPython, '');
    await svc.prepare();
    await flush();
    children[0].end(0);
    await svc.whenIdle();
    expect(cb).toHaveBeenCalled();
  });
});
