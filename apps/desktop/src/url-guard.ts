/** Solo http(s) puede abrirse en el navegador del sistema (nunca file:, javascript:, etc.). */
export function isSafeExternalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** ¿La URL pertenece al origen local de la app (http://localhost:<puerto>)? */
export function isLocalOrigin(raw: string, origin: string): boolean {
  try {
    return new URL(raw).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}
