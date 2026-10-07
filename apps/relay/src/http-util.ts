/**
 * Reescribe un Set-Cookie de la API para que valga bajo `/d/<deviceId>`: el Path pasa a
 * `<base><path>`, se quita Domain y (si `secure`) se fuerza Secure. Sin Path se acota a `<base>/`.
 */
export function rewriteSetCookie(cookie: string, base: string, secure: boolean): string {
  const parts = cookie.split(';').map((p) => p.trim());
  const out: string[] = [parts[0]];
  let hasPath = false;
  let hasSecure = false;
  for (const attr of parts.slice(1)) {
    const lower = attr.toLowerCase();
    if (lower.startsWith('domain=')) continue;
    if (lower.startsWith('path=')) {
      const p = attr.slice(5) || '/';
      out.push(`Path=${base}${p.startsWith('/') ? p : `/${p}`}`);
      hasPath = true;
      continue;
    }
    if (lower === 'secure') hasSecure = true;
    out.push(attr);
  }
  if (!hasPath) out.push(`Path=${base}/`);
  if (secure && !hasSecure) out.push('Secure');
  return out.filter(Boolean).join('; ');
}

/** Extrae el deviceId y el resto de la ruta de `/d/<id>[/resto]` (null si no encaja). */
export function matchDevicePath(url: string): { deviceId: string; rest: string } | null {
  const m = /^\/d\/([A-Za-z0-9_-]{1,64})(\/[^?]*)?(\?.*)?$/.exec(url);
  if (!m) return null;
  return { deviceId: m[1], rest: m[2] ?? '/' };
}

/** Manifest de la PWA para un dispositivo: arranca y se acota en `/d/<id>/`. */
export function deviceManifest(manifestJson: string, base: string): string {
  const m = JSON.parse(manifestJson) as Record<string, unknown>;
  m.id = `${base}/`;
  m.start_url = `${base}/tickets`;
  m.scope = `${base}/`;
  return JSON.stringify(m);
}
