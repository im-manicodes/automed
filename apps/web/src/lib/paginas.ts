import { apiUrl } from './base'

/** URL de la imagen PNG de una página (misma origen, con cookie de sesión). Se usa en <img>, no es un fetch. */
export const urlImagenPagina = (attachmentId: string, n: number) =>
  apiUrl(`/attachments/${encodeURIComponent(attachmentId)}/pages/${n}/image`);
