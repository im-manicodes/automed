/**
 * Ruta base de la app. Normal: ''. Desde el celular por el relay la app vive bajo
 * `/d/<deviceId>` (el relay la sirve y reenvía `/d/<id>/api/*` al escritorio).
 */
export function detectBasePath(pathname: string): string {
  const m = /^\/d\/([A-Za-z0-9_-]{1,64})(?:\/|$)/.exec(pathname)
  return m ? `/d/${m[1]}` : ''
}

export const BASE_PATH = typeof window === 'undefined' ? '' : detectBasePath(window.location.pathname)

/** URL de la API (con la base): '/threads' -> '/api/threads' o '/d/<id>/api/threads'. */
export const apiUrl = (path: string, base: string = BASE_PATH) => `${base}/api${path}`
