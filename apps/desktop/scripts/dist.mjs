#!/usr/bin/env node
/**
 * Construye el instalable de escritorio de auto-med.
 *
 *   node apps/desktop/scripts/dist.mjs [linux|win] [--smoke] [--dry-run] [--clean]
 *   pnpm desktop:dist                 (destino automatico: el del sistema donde corres el comando)
 *   pnpm desktop:dist -- win --smoke  (en Windows: instalador .exe y prueba de humo)
 *
 * IMPORTANTE: se construye en el sistema operativo de destino. El empaquetado incluye modulos nativos
 * (@napi-rs/canvas, @node-rs/argon2) y los binarios de Postgres embebido, y `pnpm deploy` los instala
 * para la plataforma donde corre. Un .exe construido en Linux llevaria binarios de Linux y no
 * funcionaria. Para Windows sin tener un Windows: el workflow release-desktop.yml (GitHub Actions).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(desktop, '../..');
const release = join(desktop, 'release');

const args = process.argv.slice(2).filter((a) => a !== '--');
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const known = new Set(['--smoke', '--dry-run', '--clean']);
for (const f of flags) {
  if (!known.has(f)) fail(`Opción desconocida: ${f}. Opciones: --smoke, --dry-run, --clean.`);
}
const wanted = positional[0] ?? 'auto';
if (!['auto', 'linux', 'win'].includes(wanted)) {
  fail(`Destino desconocido: "${wanted}". Usa "linux" o "win" (o nada para el sistema actual).`);
}

const here = process.platform === 'win32' ? 'win' : process.platform === 'linux' ? 'linux' : null;
if (!here) {
  fail(`Este sistema (${process.platform}) no está soportado. El instalable es para Linux y Windows.`);
}
const target = wanted === 'auto' ? here : wanted;

if (target !== here) {
  const nombre = { linux: 'Linux', win: 'Windows' };
  fail(
    `No se puede construir el instalable de ${nombre[target]} desde ${nombre[here]}.\n` +
      `El empaquetado incluye módulos nativos y binarios de Postgres que se instalan para el sistema donde corre,\n` +
      `así que el resultado no funcionaría en ${nombre[target]}.\n` +
      (target === 'win'
        ? `Opciones: ejecuta este mismo comando en un Windows (pnpm desktop:dist), o lanza el workflow\n` +
          `"release-desktop" en GitHub Actions (pestaña Actions -> Run workflow), que construye en windows-latest.`
        : `Ejecuta este comando en un Linux o lanza el workflow "release-desktop" en GitHub Actions.`),
  );
}

const dry = flags.has('--dry-run');
function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}
function run(cmd, cmdArgs, cwd = root) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  if (dry) return;
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd, shell: process.platform === 'win32' });
  if (r.status !== 0) fail(`Falló: ${cmd} ${cmdArgs.join(' ')} (código ${r.status ?? 'sin código'}).`);
}

console.log(`Construyendo el instalable de ${target === 'win' ? 'Windows (NSIS x64)' : 'Linux (AppImage + deb x64)'}…`);

if (flags.has('--clean')) {
  console.log(`\nLimpiando ${release}`);
  if (!dry) rmSync(release, { recursive: true, force: true });
}

// Los scripts de apps/desktop ya encadenan: recursos (web + api + migraciones) -> tsc -> electron-builder.
run('pnpm', ['--filter', 'desktop', target === 'win' ? 'dist:win' : 'dist:linux']);

if (flags.has('--smoke')) {
  run('node', ['scripts/smoke.mjs'], desktop);
}

if (dry) {
  console.log('\n(--dry-run: no se ejecutó nada)');
  process.exit(0);
}

const exts = target === 'win' ? ['.exe'] : ['.AppImage', '.deb'];
const out = existsSync(release)
  ? readdirSync(release).filter((f) => exts.some((e) => f.endsWith(e)))
  : [];
if (out.length === 0) fail(`No se encontraron instaladores (${exts.join(', ')}) en ${release}.`);
console.log('\nListo. Instaladores generados:');
for (const f of out) {
  const mb = (statSync(join(release, f)).size / 1024 / 1024).toFixed(0);
  console.log(`  ${join(release, f)}  (${mb} MB)`);
}
if (!flags.has('--smoke')) {
  console.log('\nTip: añade --smoke para comprobar que el paquete arranca (Postgres, migraciones, API).');
}
