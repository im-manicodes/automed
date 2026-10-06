import { useEffect, useRef, type RefObject } from 'react';
import { factorRueda } from '../lib/viewport';

/**
 * Rueda del ratón sobre `ref`: llama a `onZoom(factor, x, y)` con el punto relativo al elemento.
 * Usa un listener nativo no pasivo para poder impedir el scroll de la página.
 */
export function useRuedaZoom(ref: RefObject<HTMLElement | null>, onZoom: (factor: number, x: number, y: number) => void) {
  const cb = useRef(onZoom);
  useEffect(() => {
    cb.current = onZoom;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const alRodar = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      cb.current(factorRueda(e.deltaY, e.deltaMode), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', alRodar, { passive: false });
    return () => el.removeEventListener('wheel', alRodar);
  }, [ref]);
}
