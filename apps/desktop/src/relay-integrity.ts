import { createHash } from 'node:crypto';
import { BOOTSTRAP_SHA256 } from './bootstrap-hashes';

export type EstadoArranque = 'ok' | 'distinto' | 'sin_comprobar';

/**
 * El escritorio (de confianza) pide al relay los 3 archivos del arranque y compara su hash con el que trae
 * esta versión de la app (`bootstrap-hashes.ts`, igual al publicado en docs/relay-e2e.md). Detecta un relay
 * alterado de forma general; NO detecta uno que sirva algo distinto solo a ciertos celulares (límite documentado).
 */
export async function checkRelayBootstrap(
  relayUrl: string,
  deviceId: string,
  o: { fetchFn?: typeof fetch; expected?: Record<string, string>; timeoutMs?: number } = {},
): Promise<EstadoArranque> {
  const f = o.fetchFn ?? fetch;
  const expected = o.expected ?? BOOTSTRAP_SHA256.files;
  const urls: Record<string, string> = {
    'index.html': `${relayUrl}/d/${deviceId}/`,
    'boot.js': `${relayUrl}/boot.js`,
    'sw.js': `${relayUrl}/d/${deviceId}/sw.js`,
  };
  try {
    let distinto = false;
    for (const [name, url] of Object.entries(urls)) {
      const res = await f(url, { redirect: 'manual', signal: AbortSignal.timeout(o.timeoutMs ?? 10_000), cache: 'no-store' });
      if (res.status >= 500 || res.status === 429) return 'sin_comprobar';
      const sha = res.status === 200 ? createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex') : '';
      if (sha !== expected[name]) distinto = true;
    }
    return distinto ? 'distinto' : 'ok';
  } catch {
    return 'sin_comprobar';
  }
}
