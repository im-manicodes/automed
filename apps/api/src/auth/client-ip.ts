import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

type ReqLike = { ip?: string; headers?: Record<string, unknown> };

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * IP del cliente para los límites de intentos. Por el relay la API ve siempre 127.0.0.1; el cliente
 * del túnel (escritorio) añade la IP real del celular en `x-automed-relay-ip` junto con un token
 * por arranque (`RELAY_IP_TOKEN`, solo lo conocen el escritorio y la API). Sin token válido la
 * cabecera se ignora (un cliente directo al puerto local no puede falsear su IP).
 */
export function clientIp(req: ReqLike): string {
  const token = process.env.RELAY_IP_TOKEN;
  const h = req.headers ?? {};
  const ip = h['x-automed-relay-ip'];
  const got = h['x-automed-relay-token'];
  if (
    token &&
    typeof got === 'string' &&
    typeof ip === 'string' &&
    same(got, token) &&
    isIP(ip)
  )
    return ip;
  return String(req.ip);
}
