#!/usr/bin/env node
/**
 * Empaqueta el código del OCR local (services/ocr-local/app + requirements.txt, unos KB) en
 * apps/api/assets/ocr-local.tgz y lo copia a dist/assets/ (lo usa OcrInstallerService en runtime).
 * Tarball determinista (orden, fechas y dueños fijos; gzip sin fecha): no cambia si el código no cambia.
 * Si services/ocr-local no está (p. ej. un build que solo copia apps/api) se reutiliza el
 * paquete existente; si tampoco existe, avisa sin fallar (la instalación lo informará en la UI).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(apiDir, '..', '..', 'services', 'ocr-local');
const out = join(apiDir, 'assets', 'ocr-local.tgz');
const distOut = join(apiDir, 'dist', 'assets', 'ocr-local.tgz');

if (existsSync(join(src, 'app', 'main.py')) && existsSync(join(src, 'requirements.txt'))) {
  const tar = spawnSync(
    'tar',
    [
      '--sort=name',
      '--mtime=@0',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '--exclude=__pycache__',
      '--exclude=*.pyc',
      '-cf',
      '-',
      '-C',
      src,
      'app',
      'requirements.txt',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (tar.status !== 0) {
    console.error(`[ocr-asset] tar falló: ${tar.stderr?.toString() ?? ''}`);
    process.exit(1);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, gzipSync(tar.stdout, { level: 9 }));
  console.log(`[ocr-asset] ${out} (${tar.stdout.length} bytes sin comprimir)`);
} else if (existsSync(out)) {
  console.log('[ocr-asset] services/ocr-local no está; se usa el paquete existente.');
} else {
  console.warn('[ocr-asset] AVISO: no hay services/ocr-local ni assets/ocr-local.tgz; el OCR local no se podrá instalar.');
  process.exit(0);
}

if (existsSync(join(apiDir, 'dist'))) {
  mkdirSync(dirname(distOut), { recursive: true });
  copyFileSync(out, distOut);
}
