import { useEffect, useState } from 'react';
import { apiBlob } from '../lib/api';
import { usaE2e } from '../lib/e2e';
import { urlImagenPagina } from '../lib/paginas';

interface Entrada {
  el: HTMLImageElement;
  /** Solo con cifrado E2E: blob URL que hay que liberar con URL.revokeObjectURL. */
  blobUrl?: string;
  /** Instancias del hook que la están usando (solo cuenta para las de blobUrl). */
  usos: number;
}

const cache = new Map<string, Entrada>();

/** Quita un uso; una entrada con blob sin usos se borra y libera su memoria. */
function soltar(clave: string, e: Entrada) {
  e.usos -= 1;
  if (e.usos > 0 || !e.blobUrl) return;
  URL.revokeObjectURL(e.blobUrl);
  if (cache.get(clave) === e) cache.delete(clave);
}

/** Solo pruebas: vacía la caché. */
export function _vaciarCachePaginas() {
  for (const e of cache.values()) if (e.blobUrl) URL.revokeObjectURL(e.blobUrl);
  cache.clear();
}

/**
 * Carga (y cachea) la imagen PNG de una página. Por el relay (cifrado E2E) un <img src> directo no
 * puede descifrar: se pide la imagen cifrada, se descifra a un Blob y se usa su blob URL
 * (`img.src`); ese blob se libera (URL.revokeObjectURL) al cambiar de página o desmontar, cuando
 * ya nadie lo usa. Es la única excepción a «toda petición con useQuery/useMutation».
 */
export function usePaginaImagen(attachmentId: string, pageNumber: number | undefined) {
  const clave = `${attachmentId}:${pageNumber}`;
  const [img, setImg] = useState<HTMLImageElement | null>(() => cache.get(clave)?.el ?? null);
  const [error, setError] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (pageNumber === undefined) return;
    let cancelado = false;
    let tomada: Entrada | null = null; // entrada de la caché que esta instancia está usando

    const tomar = (e: Entrada) => {
      e.usos += 1;
      tomada = e;
      setImg(e.el);
    };

    const hit = cache.get(clave);
    if (hit) {
      tomar(hit);
      // oxlint-disable-next-line react/set-state-in-effect -- patrón de carga inicial / sincronización con la red o la imagen; no cambia el comportamiento
      setError(false);
      return () => {
        if (tomada) soltar(clave, tomada);
      };
    }
    setImg(null);
    setError(false);
    const el = new Image();
    let blobUrl: string | undefined;
    el.onload = () => {
      if (cancelado) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        return;
      }
      const otra = cache.get(clave);
      if (otra && blobUrl) {
        // Otra instancia ya la cargó mientras tanto: se usa esa y se libera este blob.
        URL.revokeObjectURL(blobUrl);
        tomar(otra);
        return;
      }
      const nueva: Entrada = { el, blobUrl, usos: 0 };
      cache.set(clave, nueva);
      tomar(nueva);
    };
    el.onerror = () => {
      if (cancelado) return;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setError(true);
    };
    if (usaE2e()) {
      apiBlob(`/attachments/${encodeURIComponent(attachmentId)}/pages/${pageNumber}/image`)
        .then((blob) => {
          if (cancelado) return;
          blobUrl = URL.createObjectURL(blob);
          el.src = blobUrl;
        })
        .catch(() => {
          if (!cancelado) setError(true);
        });
    } else {
      el.src = urlImagenPagina(attachmentId, pageNumber);
    }
    return () => {
      cancelado = true;
      if (tomada) soltar(clave, tomada);
      // Si no llegó a cargar (no entró en la caché), se libera el blob.
      else if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [attachmentId, pageNumber, clave, intento]);

  return { img, error, reintentar: () => setIntento((n) => n + 1) };
}
