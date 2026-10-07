#!/usr/bin/env node
/**
 * Genera apps/desktop/build-resources/ (lo que electron-builder copia a `resources/`):
 *   api/          dist + prisma/migrations + node_modules de PRODUCCION podado (sin CLI de Prisma ni schema-engine)
 *   web/          apps/web/dist
 *   ocr-local/    services/ocr-local/{app,requirements.txt}
 *   build-config.json
 * Reproducible y multiplataforma (solo Node). Opciones: --skip-build (reusa los dist existentes).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const root = resolve(desktop, '..', '..');
const out = join(desktop, 'build-resources');
const skipBuild = process.argv.includes('--skip-build');
// Paquetes que NO viajan aunque sean dependencias de produccion de la API (solo CLI/herramientas de Prisma).
const EXCLUDE = new Set(['prisma']);

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(`Fallo: ${cmd} ${args.join(' ')}`);
}
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const copy = (from, to) => cpSync(from, to, { recursive: true, dereference: true });

if (!skipBuild) {
  run('pnpm', ['--filter', 'web', 'build']);
  run('pnpm', ['--filter', 'api', 'build']);
}
for (const p of [join(root, 'apps/web/dist/index.html'), join(root, 'apps/api/dist/main-desktop.js')]) {
  if (!existsSync(p)) throw new Error(`Falta ${p}; ejecuta sin --skip-build`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1) deploy de produccion con node_modules plano (hoisted): sin enlaces simbolicos, apto para Windows.
const tmp = mkdtempSync(join(tmpdir(), 'automed-deploy-'));
const deploy = join(tmp, 'api');
try {
  run('pnpm', ['--filter', 'api', '--legacy', 'deploy', '--prod', '--config.node-linker=hoisted', deploy]);

  // 2) poda por alcanzabilidad desde las dependencias de la API (menos EXCLUDE).
  const nm = join(deploy, 'node_modules');
  const apiPkg = readJson(join(deploy, 'package.json'));
  const keep = new Set();
  const resolveDir = (name, from) => {
    let dir = from;
    for (;;) {
      const cand = join(dir, 'node_modules', name);
      if (existsSync(join(cand, 'package.json'))) return cand;
      const parent = dirname(dir);
      if (parent === dir || dir.length <= deploy.length) return null;
      dir = parent;
    }
  };
  const visit = (dir) => {
    if (keep.has(dir)) return;
    keep.add(dir);
    const pj = readJson(join(dir, 'package.json'));
    for (const dep of Object.keys({ ...pj.dependencies, ...pj.optionalDependencies })) {
      if (EXCLUDE.has(dep)) continue;
      const d = resolveDir(dep, dir);
      if (d) visit(d);
    }
  };
  for (const dep of Object.keys(apiPkg.dependencies ?? {})) {
    if (EXCLUDE.has(dep)) continue;
    const d = resolveDir(dep, deploy);
    if (d) visit(d);
  }
  // Se conservan los paquetes alcanzables (y las carpetas de scope que los contienen).
  let removed = 0;
  const prune = (base) => {
    for (const name of readdirSync(base)) {
      if (name === '.bin' || name === '.pnpm' || name === '.modules.yaml') {
        rmSync(join(base, name), { recursive: true, force: true });
        continue;
      }
      const p = join(base, name);
      if (name.startsWith('@')) {
        prune(p);
        if (readdirSync(p).length === 0) rmSync(p, { recursive: true, force: true });
        continue;
      }
      if (!keep.has(p)) {
        rmSync(p, { recursive: true, force: true });
        removed++;
      }
    }
  };
  prune(nm);
  // Enlaces de ejecutables (.bin) de cualquier nivel: no hacen falta y quedan rotos al copiar.
  const dropBins = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.name === '.bin') rmSync(p, { recursive: true, force: true });
      else if (e.isDirectory()) dropBins(p);
    }
  };
  dropBins(nm);
  // Paquetes anidados (node_modules dentro de un paquete) tambien podados si no son alcanzables.
  console.log(`podados ${removed} paquetes; se conservan ${keep.size}`);

  // 3) ensamblar api/
  const apiOut = join(out, 'api');
  mkdirSync(apiOut, { recursive: true });
  copy(nm, join(apiOut, 'node_modules'));
  copy(join(root, 'apps/api/dist'), join(apiOut, 'dist'));
  copy(join(root, 'apps/api/prisma/migrations'), join(apiOut, 'prisma/migrations'));
  copy(join(deploy, 'package.json'), join(apiOut, 'package.json'));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// 4) web, OCR local y configuracion de compilacion
copy(join(root, 'apps/web/dist'), join(out, 'web'));
mkdirSync(join(out, 'ocr-local'), { recursive: true });
copy(join(root, 'services/ocr-local/app'), join(out, 'ocr-local/app'));
copy(join(root, 'services/ocr-local/requirements.txt'), join(out, 'ocr-local/requirements.txt'));
rmSync(join(out, 'ocr-local/app/__pycache__'), { recursive: true, force: true });
copy(join(desktop, 'build-config.json'), join(out, 'build-config.json'));

const du = (p) => {
  let t = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const f = join(p, e.name);
    t += e.isDirectory() ? du(f) : lstatSync(f).size;
  }
  return t;
};
for (const d of ['api', 'web', 'ocr-local']) console.log(`${d}: ${(du(join(out, d)) / 1048576).toFixed(1)} MB`);
console.log(`Recursos listos en ${out}`);
