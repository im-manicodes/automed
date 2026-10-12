import { useEffect, useRef, useState } from 'react';
import { useMutation } from '../../../hooks/useMutation';

// Caché en memoria por duda (solo resultados con sugerencias): volver con «Anterior»/«Siguiente»
// muestra lo ya consultado sin pulsar de nuevo.
const cache = new Map<string, string[]>();

/** Solo para pruebas. */
export function limpiarCacheSugerencias() {
  cache.clear();
}

export type EstadoSugerencias = 'inicial' | 'cargando' | 'listo' | 'error';

/**
 * Pide a la IA hasta 2 lecturas posibles del recorte (`POST /ocr/regions/:id/suggest`),
 * SOLO cuando se llama a `pedir(texto)` (botón «Obtener recomendaciones»). No guarda nada.
 * Vacío o fallo = estado `error` (no se cachea; permite «Intentar otra vez»).
 */
export function useSugerencias(regionId: string) {
  const { mutate } = useMutation<{ sugerencias: string[] }, { texto: string }>({ url: '/ocr/regions', method: 'POST' });
  const [res, setRes] = useState<{ id: string; estado: EstadoSugerencias; sugerencias: string[] } | null>(null);
  const cargando = useRef(false);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const previo = cache.get(regionId);
  const actual = res && res.id === regionId ? res : null;
  const estado: EstadoSugerencias = actual ? actual.estado : previo ? 'listo' : 'inicial';
  const sugerencias = actual ? actual.sugerencias : (previo ?? []);

  const pedir = async (texto: string) => {
    if (cargando.current) return;
    cargando.current = true;
    setRes({ id: regionId, estado: 'cargando', sugerencias: [] });
    let lista: string[] = [];
    try {
      const r = await mutate({ urlParams: `/${regionId}/suggest`, body_params: { texto } });
      lista = Array.isArray(r?.sugerencias) ? r.sugerencias.filter((s) => typeof s === 'string' && s.trim()).slice(0, 2) : [];
    } catch {
      lista = [];
    }
    cargando.current = false;
    if (lista.length) cache.set(regionId, lista);
    if (vivo.current) setRes({ id: regionId, estado: lista.length ? 'listo' : 'error', sugerencias: lista });
  };

  return { estado, sugerencias, pedir };
}
