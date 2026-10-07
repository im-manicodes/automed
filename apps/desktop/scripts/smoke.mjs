#!/usr/bin/env node
/**
 * Prueba de humo del binario empaquetado (Linux): xvfb-run + --smoke-test con una carpeta de datos temporal.
 * Uso: node scripts/smoke.mjs [ruta-al-ejecutable]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exe =
  process.argv[2] ??
  (process.platform === 'win32'
    ? join(desktop, 'release/win-unpacked/auto-med.exe')
    : join(desktop, 'release/linux-unpacked/auto-med'));
if (!existsSync(exe)) {
  console.error(`No existe ${exe}; empaqueta primero (pnpm desktop:dist:linux / pack:linux).`);
  process.exit(2);
}
const data = mkdtempSync(join(tmpdir(), 'automed-smoke-'));
const args = ['--no-sandbox', '--smoke-test'];
const [cmd, a] =
  process.platform === 'linux' && !process.env.DISPLAY
    ? ['xvfb-run', ['-a', exe, ...args]]
    : [exe, args];
const r = spawnSync(cmd, a, {
  stdio: 'inherit',
  env: { ...process.env, AUTOMED_DATA_DIR: data },
  timeout: 150_000,
});
rmSync(data, { recursive: true, force: true });
process.exit(r.status ?? 1);
