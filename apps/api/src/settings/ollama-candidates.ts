import { readFileSync } from 'fs';

/**
 * Interpreta /proc/net/route y devuelve la puerta de enlace por defecto
 * (Destination 00000000; Gateway en hex little-endian) como IPv4 punteada.
 */
export function parseDefaultGateway(procNetRoute: string): string | undefined {
  for (const line of procNetRoute.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 3 || cols[1] !== '00000000') continue;
    const hex = cols[2];
    if (!/^[0-9A-Fa-f]{8}$/.test(hex)) continue;
    const n = parseInt(hex, 16);
    if (n === 0) continue;
    return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
      .map(String)
      .join('.');
  }
  return undefined;
}

/** Lee la puerta de enlace por defecto del contenedor; undefined si no se puede. */
export function readGateway(): string | undefined {
  try {
    return parseDefaultGateway(readFileSync('/proc/net/route', 'utf8'));
  } catch {
    return undefined;
  }
}

/** URLs donde probar Ollama (API compatible OpenAI, sufijo /v1), en orden. */
export function ollamaCandidates(opts: {
  docker: boolean;
  gateway?: string;
  port?: number;
}): string[] {
  const port = opts.port ?? 11434;
  const at = (host: string) => `http://${host}:${port}/v1`;
  if (!opts.docker) return [at('localhost')];
  // Docker: Ollama es el servicio `ollama` del compose; el resto es respaldo.
  const out = [at('ollama'), at('host.docker.internal')];
  if (opts.gateway) out.push(at(opts.gateway));
  out.push(at('localhost'));
  return out;
}
