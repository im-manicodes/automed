import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  access,
  constants,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { StorageService } from './storage.service';

const TMP_PREFIX = '.tmp-';

/**
 * Almacenamiento en disco (modo escritorio). `STORAGE_DRIVER=fs`; raíz `DATA_DIR/storage`.
 * Las claves con `/` son rutas relativas a la raíz; se rechaza todo lo que pueda salirse de ella.
 */
@Injectable()
export class FsStorageService extends StorageService implements OnModuleInit {
  private readonly logger = new Logger(FsStorageService.name);
  readonly root: string;

  constructor(config: ConfigService) {
    super();
    this.root = resolve(config.get<string>('DATA_DIR') ?? 'data', 'storage');
  }

  async onModuleInit() {
    try {
      await mkdir(this.root, { recursive: true });
    } catch {
      this.logger.warn('No se pudo crear el directorio de almacenamiento');
    }
  }

  /** Valida la clave (o prefijo) y devuelve su ruta absoluta dentro de la raíz. */
  private pathFor(key: string): string {
    if (
      !key ||
      key.includes('\0') ||
      key.includes('\\') ||
      key.startsWith('/') ||
      /^[a-zA-Z]:/.test(key)
    ) {
      throw new Error('Clave de almacenamiento no válida');
    }
    const parts = key.split('/');
    // Se permite un último segmento vacío (prefijo terminado en '/').
    parts.forEach((p, i) => {
      if (p === '..' || p === '.' || (p === '' && i !== parts.length - 1)) {
        throw new Error('Clave de almacenamiento no válida');
      }
    });
    const full = resolve(this.root, ...parts);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('Clave de almacenamiento no válida');
    }
    return full;
  }

  async isHealthy(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true });
      const s = await stat(this.root);
      if (!s.isDirectory()) return false;
      await access(this.root, constants.R_OK | constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  private tmpPath(target: string) {
    return join(
      dirname(target),
      `${TMP_PREFIX}${randomBytes(8).toString('hex')}`,
    );
  }

  /** Escritura atómica: archivo temporal en la misma carpeta + rename. Los metadatos se ignoran. */
  /** (contentType y metadatos de la firma base se ignoran en disco) */
  async put(
    key: string,
    body: Buffer | Uint8Array,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _contentType?: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _metadata?: Record<string, string>,
  ) {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    const tmp = this.tmpPath(target);
    try {
      await writeFile(tmp, body);
      await rename(tmp, target);
    } catch (e) {
      await unlink(tmp).catch(() => undefined);
      throw e;
    }
  }

  async copy(srcKey: string, dstKey: string) {
    const src = this.pathFor(srcKey);
    const dst = this.pathFor(dstKey);
    await mkdir(dirname(dst), { recursive: true });
    const tmp = this.tmpPath(dst);
    try {
      await copyFile(src, tmp);
      await rename(tmp, dst);
    } catch (e) {
      await unlink(tmp).catch(() => undefined);
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.pathFor(key), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string) {
    const path = this.pathFor(key);
    try {
      await unlink(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      return;
    }
    await this.pruneEmptyDirs(dirname(path));
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(key)));
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    if (!prefix) throw new Error('El prefijo no puede estar vacío');
    const full = this.pathFor(prefix);
    // Carpeta más profunda que contiene todo lo que empieza por el prefijo.
    const baseDir = prefix.endsWith('/') ? full : dirname(full);
    const prefixPath = prefix.endsWith('/') ? full + sep : full;
    let deleted = 0;
    for (const file of await this.walk(baseDir)) {
      if (!file.startsWith(prefixPath)) continue;
      try {
        await unlink(file);
        deleted++;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    await this.pruneEmptyTree(baseDir);
    await this.pruneEmptyDirs(baseDir);
    return deleted;
  }

  private async walk(dir: string): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith(TMP_PREFIX)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...(await this.walk(p)));
      else out.push(p);
    }
    return out;
  }

  /** Borra, de abajo arriba, las subcarpetas vacías de `dir` (sin borrar `dir`). */
  private async pruneEmptyTree(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = join(dir, e.name);
      await this.pruneEmptyTree(p);
      await rmdir(p).catch(() => undefined);
    }
  }

  /** Borra carpetas vacías desde `dir` hacia arriba, sin tocar la raíz. */
  private async pruneEmptyDirs(dir: string) {
    let cur = dir;
    while (cur.startsWith(this.root + sep)) {
      try {
        await rmdir(cur); // falla si no está vacía
      } catch {
        return;
      }
      cur = dirname(cur);
    }
  }
}
