import { mkdtemp, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStorageService } from './fs-storage.service';

describe('FsStorageService', () => {
  let dir: string;
  let svc: FsStorageService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fs-storage-'));
    svc = new FsStorageService({
      get: (k: string) => (k === 'DATA_DIR' ? dir : undefined),
    } as any);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const bytes = (s: string) => new TextEncoder().encode(s);
  const text = (u: Uint8Array) => new TextDecoder().decode(u);

  it('usa DATA_DIR/storage como raíz', () => {
    expect(svc.root).toBe(join(dir, 'storage'));
  });

  it('put/get/exists/delete con claves con barras', async () => {
    const key = 'hilos/t1/pdf_1/original.pdf';
    expect(await svc.exists(key)).toBe(false);
    await svc.put(key, bytes('hola'), 'application/pdf', { filename: 'ñ.pdf' });
    expect(await svc.exists(key)).toBe(true);
    expect(text(await svc.get(key))).toBe('hola');
    await svc.delete(key);
    expect(await svc.exists(key)).toBe(false);
    // no falla si ya no existe y limpia las carpetas vacías
    await svc.delete(key);
    expect(await readdir(svc.root)).toEqual([]);
  });

  it('put sobrescribe y no deja archivos temporales', async () => {
    await svc.put('a/b.txt', bytes('1'));
    await svc.put('a/b.txt', bytes('22'));
    expect(text(await svc.get('a/b.txt'))).toBe('22');
    expect(await readdir(join(svc.root, 'a'))).toEqual(['b.txt']);
  });

  it('put atómico: si falla el rename no queda el temporal ni el destino', async () => {
    // El destino es un directorio: rename del temporal falla.
    await mkdir(join(svc.root, 'x', 'dir'), { recursive: true });
    await writeFile(join(svc.root, 'x', 'dir', 'f'), 'z');
    await expect(svc.put('x/dir', bytes('n'))).rejects.toBeDefined();
    expect(await readdir(join(svc.root, 'x'))).toEqual(['dir']);
  });

  it('copy duplica el contenido', async () => {
    await svc.put('hilos/t1/pdf_1/pagina_1.png', bytes('png'));
    await svc.copy(
      'hilos/t1/pdf_1/pagina_1.png',
      'hilos/t2/pdf_1/pagina_1.png',
    );
    expect(text(await svc.get('hilos/t2/pdf_1/pagina_1.png'))).toBe('png');
    expect(await svc.exists('hilos/t1/pdf_1/pagina_1.png')).toBe(true);
    await expect(svc.copy('no/existe', 'z/z')).rejects.toBeDefined();
  });

  it('deleteByPrefix borra recursivamente solo lo que coincide y limpia carpetas', async () => {
    await svc.put('hilos/t1/pdf_1/original.pdf', bytes('a'));
    await svc.put('hilos/t1/pdf_1/pagina_1.png', bytes('b'));
    await svc.put('hilos/t1/pdf_2/original.pdf', bytes('c'));
    await svc.put('hilos/t10/pdf_1/original.pdf', bytes('d'));
    expect(await svc.deleteByPrefix('hilos/t1/')).toBe(3);
    expect(await svc.exists('hilos/t10/pdf_1/original.pdf')).toBe(true);
    expect(await readdir(join(svc.root, 'hilos'))).toEqual(['t10']);
    expect(await svc.deleteByPrefix('hilos/noexiste/')).toBe(0);
    // prefijo sin barra final: coincide por cadena como en S3
    expect(await svc.deleteByPrefix('hilos/t1')).toBe(1);
    await expect(svc.deleteByPrefix('')).rejects.toThrow();
  });

  it('rechaza path traversal, rutas absolutas y bytes nulos', async () => {
    const bad = [
      '../fuera.txt',
      'a/../../fuera.txt',
      '/etc/passwd',
      'a//b',
      './a',
      'a\\..\\b',
      'C:/x',
      'a\0b',
      '',
    ];
    for (const k of bad) {
      await expect(svc.put(k, bytes('x'))).rejects.toThrow();
      await expect(svc.get(k)).rejects.toThrow();
      expect(await svc.exists(k)).toBe(false);
    }
    await expect(svc.deleteByPrefix('../')).rejects.toThrow();
    await expect(svc.copy('a', '../b')).rejects.toThrow();
  });

  it('isHealthy: true con directorio escribible, false si la raíz es un archivo', async () => {
    expect(await svc.isHealthy()).toBe(true);
    expect((await stat(svc.root)).isDirectory()).toBe(true);
    const f = join(dir, 'archivo');
    await writeFile(f, 'x');
    const bad = new FsStorageService({
      get: (k: string) => (k === 'DATA_DIR' ? f : undefined),
    } as any);
    expect(await bad.isHealthy()).toBe(false);
  });
});
