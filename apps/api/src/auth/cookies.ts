export const ACCESS_COOKIE = 'am_access';
export const REFRESH_COOKIE = 'am_refresh';

export function parseCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

/** Convierte '15m', '30d', '12h', '45s' o un número (segundos) a milisegundos. */
export function parseDuration(value: string | undefined, fallback: string) {
  const raw = (value || fallback).trim();
  const m = /^(\d+)\s*([smhd]?)$/.exec(raw);
  if (!m) throw new Error(`Duración inválida: "${raw}" (usa p. ej. 15m, 30d)`);
  const unit = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]]!;
  return Number(m[1]) * unit * 1000;
}

export interface CookieOpts {
  secure: boolean;
  path: string;
  maxAgeMs: number;
}

export function cookieHeader(
  name: string,
  value: string,
  { secure, path, maxAgeMs }: CookieOpts,
): string {
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`;
}
