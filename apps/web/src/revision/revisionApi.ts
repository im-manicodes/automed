import type { ApiPagesResponse } from './lib/types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
  /** Errores que no mejoran reintentando (sesión vencida, datos inválidos, no existe). */
  get definitivo(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`/api${ruta}`, {
      credentials: 'include',
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError(0, 'Sin conexión');
  }
  if (!resp.ok) {
    let msg = 'Algo salió mal';
    try {
      const j = (await resp.json()) as { message?: string | string[] };
      if (j.message) msg = Array.isArray(j.message) ? j.message.join(', ') : j.message;
    } catch {
      /* sin cuerpo JSON */
    }
    throw new ApiError(resp.status, msg);
  }
  return (await resp.json()) as T;
}

export const obtenerPaginas = (attachmentId: string) =>
  pedir<ApiPagesResponse>(`/attachments/${encodeURIComponent(attachmentId)}/pages`);

export const corregirRegion = (regionId: string, textoUsuario: string) =>
  pedir<{ id: string; status: string; textoUsuario: string }>(`/ocr/regions/${encodeURIComponent(regionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ textoUsuario }),
  });

/** URL de la imagen PNG de una página (misma origen, con cookie de sesión). */
export const urlImagenPagina = (attachmentId: string, n: number) =>
  `/api/attachments/${encodeURIComponent(attachmentId)}/pages/${n}/image`;
