import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, corregirRegion } from './revisionApi';

export type EstadoGuardado = 'guardando' | 'guardado' | 'error';

const ESPERAS_MS = [1000, 2500, 6000];

/**
 * Guarda correcciones sin bloquear la pantalla: cada duda tiene su estado,
 * se reintenta sola ante fallas de red y el texto queda disponible para
 * reintentar a mano si se agotan los intentos.
 */
export function useGuardado() {
  const [estados, setEstados] = useState<Record<string, EstadoGuardado>>({});
  const textos = useRef(new Map<string, string>());
  const version = useRef(new Map<string, number>());
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const poner = (id: string, e: EstadoGuardado) => {
    if (vivo.current) setEstados((s) => ({ ...s, [id]: e }));
  };

  const enviar = useCallback(async (id: string, texto: string) => {
    textos.current.set(id, texto);
    const v = (version.current.get(id) ?? 0) + 1;
    version.current.set(id, v);
    poner(id, 'guardando');
    for (let intento = 0; intento <= ESPERAS_MS.length; intento++) {
      try {
        await corregirRegion(id, texto);
        if (version.current.get(id) === v) poner(id, 'guardado');
        return;
      } catch (e) {
        if (version.current.get(id) !== v) return; // llegó un texto más nuevo
        const definitivo = e instanceof ApiError && e.definitivo;
        if (definitivo || intento === ESPERAS_MS.length) {
          poner(id, 'error');
          return;
        }
        await new Promise((r) => setTimeout(r, ESPERAS_MS[intento]));
        if (!vivo.current) return;
      }
    }
  }, []);

  const reintentarTodo = useCallback(() => {
    for (const [id, e] of Object.entries(estados)) {
      if (e === 'error') void enviar(id, textos.current.get(id) ?? '');
    }
  }, [estados, enviar]);

  const conError = Object.values(estados).filter((e) => e === 'error').length;
  const guardando = Object.values(estados).filter((e) => e === 'guardando').length;

  return { estados, enviar, reintentarTodo, conError, guardando };
}
