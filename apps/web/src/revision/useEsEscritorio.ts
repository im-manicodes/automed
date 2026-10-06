import { useEffect, useState } from 'react';

const CONSULTA = '(min-width: 1024px)';

/** true en pantallas >= lg (1024px). Sin matchMedia (tests) es false: se usa la vista móvil. */
export function useEsEscritorio(): boolean {
  const leer = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(CONSULTA).matches;
  const [es, setEs] = useState(leer);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(CONSULTA);
    const alCambiar = () => setEs(mq.matches);
    alCambiar();
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, []);
  return es;
}
