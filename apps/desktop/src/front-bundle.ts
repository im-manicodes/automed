import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

/**
 * Front de apps/web empaquetado en el escritorio, servido al celular POR EL CANAL CIFRADO (nunca por el
 * relay). Se describe con un manifiesto (hash sha256 + tamaño + tipo de cada archivo) que el arranque
 * del relay (`apps/relay/bootstrap/boot.js`) comprueba antes de ejecutar nada. Diseño: docs/relay-e2e.md.
 */
export interface FrontManifest {
  v: 1;
  /** deviceId al que va dirigido (atado también por el AAD del sobre). */
  d: string;
  version: string;
  /** Marca de tiempo de la compilación (mayor mtime del front): el celular no acepta una menor (anti-retroceso). */
  builtAt: number;
  entry: { scripts: string[]; styles: string[] };
  files: Record<string, { sha256: string; size: number; type: string }>;
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Lo que NO viaja: el HTML (lo reemplaza `entry`), el SW y el manifest de la PWA (los pone el arranque) y los mapas. */
const SKIP = new Set(['index.html', 'sw.js', 'manifest.webmanifest']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** `<script type="module" src>` y `<link rel="stylesheet|modulepreload" href>` del index.html de Vite. */
export function parseEntry(html: string): { scripts: string[]; styles: string[] } {
  const norm = (u: string) => u.replace(/^\.?\//, '');
  const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1];
  const scripts: string[] = [];
  const styles: string[] = [];
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const src = attr(tag, 'src');
    if (src && /type\s*=\s*"module"/i.test(tag)) scripts.push(norm(src));
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const href = attr(tag, 'href');
    if (href && attr(tag, 'rel')?.toLowerCase() === 'stylesheet') styles.push(norm(href));
  }
  return { scripts, styles };
}

export class FrontBundle {
  private built: { files: Map<string, { bytes: Buffer; type: string; sha256: string }>; entry: FrontManifest['entry']; builtAt: number } | null = null;

  constructor(
    private readonly dir: string,
    private readonly version = '0',
  ) {}

  /** Se lee y se hashea una sola vez (el front empaquetado no cambia mientras corre la app). */
  private load() {
    if (this.built) return this.built;
    const files = new Map<string, { bytes: Buffer; type: string; sha256: string }>();
    let builtAt = 0;
    for (const abs of walk(this.dir)) {
      const rel = relative(this.dir, abs).split(sep).join('/');
      builtAt = Math.max(builtAt, Math.floor(statSync(abs).mtimeMs));
      if (SKIP.has(rel) || rel.endsWith('.map')) continue;
      const bytes = readFileSync(abs);
      files.set(rel, {
        bytes,
        type: TYPES[extname(rel).toLowerCase()] ?? 'application/octet-stream',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    const entry = parseEntry(readFileSync(join(this.dir, 'index.html'), 'utf8'));
    for (const p of [...entry.scripts, ...entry.styles]) {
      if (!files.has(p)) throw new Error(`El front no trae ${p}`);
    }
    if (entry.scripts.length === 0) throw new Error('El front no tiene script de entrada');
    this.built = { files, entry, builtAt };
    return this.built;
  }

  manifest(deviceId: string): Buffer {
    const b = this.load();
    const files: FrontManifest['files'] = {};
    for (const p of [...b.files.keys()].sort()) {
      const f = b.files.get(p)!;
      files[p] = { sha256: f.sha256, size: f.bytes.length, type: f.type };
    }
    const m: FrontManifest = { v: 1, d: deviceId, version: this.version, builtAt: b.builtAt, entry: b.entry, files };
    return Buffer.from(JSON.stringify(m));
  }

  /** Solo archivos listados en el manifiesto (nunca una ruta del disco arbitraria). */
  file(path: string): { bytes: Buffer; type: string } | null {
    return this.load().files.get(path) ?? null;
  }
}
