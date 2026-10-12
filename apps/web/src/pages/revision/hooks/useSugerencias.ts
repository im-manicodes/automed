import { useEffect, useState } from 'react';
import { useMutation } from '../../../hooks/useMutation';

// Caché en memoria por duda: volver con «Anterior»/«Siguiente» no repite la llamada.
const cache = new Map<string, string[]>();
const enVuelo = new Map<string, Promise<string[]>>();

/** Solo para pruebas. */
export function limpiarCacheSugerencias() {
  cache.clear();
  enVuelo.clear();
}

/**
 * Pide a la IA hasta 2 lecturas posibles del recorte (`POST /ocr/regions/:id/suggest`).
 * Son solo ayuda: no guardan nada. Los errores son silenciosos (sin sugerencias).
 * Con `activo=false` (p. ej. la duda ya tiene corrección guardada) no hace ninguna petición.
 */
export function useSugerencias(regionId: string, texto: string, activo = true) {
  const { mutate } = useMutation<{ sugerencias: string[] }, { texto: string }>({ url: '/ocr/regions', method: 'POST' });
  const [estado, setEstado] = useState<{ id: string; sugerencias: string[] } | null>(() => {
    const previo = activo ? cache.get(regionId) : undefined;
    return previo ? { id: regionId, sugerencias: previo } : null;
  });

  useEffect(() => {
    if (!activo || cache.has(regionId)) return;
    let vivo = true;
    let p = enVuelo.get(regionId);
    if (!p) {
      p = mutate({ urlParams: `/${regionId}/suggest`, body_params: { texto } })
        .then((r) => (Array.isArray(r?.sugerencias) ? r.sugerencias.filter((s) => typeof s === 'string' && s.trim()).slice(0, 2) : []))
        .catch(() => [] as string[])
        .then((s) => {
          cache.set(regionId, s);
          enVuelo.delete(regionId);
          return s;
        });
      enVuelo.set(regionId, p);
    }
    p.then((s) => {
      if (vivo) setEstado({ id: regionId, sugerencias: s });
    });
    return () => {
      vivo = false;
    };
    // El texto inicial solo importa al primer pedido de cada duda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionId, activo]);

  const listo = !!estado && estado.id === regionId;
  return { cargando: activo && !listo && !cache.has(regionId), sugerencias: activo && listo ? estado.sugerencias : [] };
}
