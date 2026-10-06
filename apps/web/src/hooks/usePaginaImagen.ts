import { useEffect, useState } from 'react';
import { urlImagenPagina } from '../lib/paginas';

const cache = new Map<string, HTMLImageElement>();

/** Carga (y cachea) la imagen PNG de una página. */
export function usePaginaImagen(attachmentId: string, pageNumber: number | undefined) {
  const clave = `${attachmentId}:${pageNumber}`;
  const [img, setImg] = useState<HTMLImageElement | null>(() => cache.get(clave) ?? null);
  const [error, setError] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (pageNumber === undefined) return;
    const hit = cache.get(clave);
    if (hit) {
      // oxlint-disable-next-line react/set-state-in-effect -- patrón de carga inicial / sincronización con la red o la imagen; no cambia el comportamiento
      setImg(hit);
      setError(false);
      return;
    }
    setImg(null);
    setError(false);
    let cancelado = false;
    const el = new Image();
    el.onload = () => {
      if (cancelado) return;
      cache.set(clave, el);
      setImg(el);
    };
    el.onerror = () => {
      if (!cancelado) setError(true);
    };
    el.src = urlImagenPagina(attachmentId, pageNumber);
    return () => {
      cancelado = true;
    };
  }, [attachmentId, pageNumber, clave, intento]);

  return { img, error, reintentar: () => setIntento((n) => n + 1) };
}
