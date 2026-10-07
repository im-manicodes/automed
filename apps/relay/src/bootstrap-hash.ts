import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Archivos del arranque cuyo hash se publica (docs/relay-e2e.md). */
export const BOOTSTRAP_FILES = ['index.html', 'boot.js', 'sw.js'] as const;

export interface BootstrapHashes {
  files: Record<(typeof BOOTSTRAP_FILES)[number], string>;
  /** sha256 de las líneas "<archivo>:<sha256>\n" en el orden de BOOTSTRAP_FILES. */
  combined: string;
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

export function bootstrapHashes(dir: string): BootstrapHashes {
  const files = Object.fromEntries(BOOTSTRAP_FILES.map((f) => [f, sha(readFileSync(join(dir, f)))])) as BootstrapHashes['files'];
  const combined = sha(BOOTSTRAP_FILES.map((f) => `${f}:${files[f]}\n`).join(''));
  return { files, combined };
}

if (require.main === module) {
  const h = bootstrapHashes(resolve(__dirname, '..', 'bootstrap'));
  for (const f of BOOTSTRAP_FILES) console.log(`${h.files[f]}  ${f}`);
  console.log(`${h.combined}  combinado`);
}
