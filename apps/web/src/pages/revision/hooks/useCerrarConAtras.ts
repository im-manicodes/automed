import { useEffect } from 'react';

const MARCA = 'amModalAtras';
/** Cierre diferido pendiente (evita un back/push de más cuando React remonta el efecto). */
let retroceso: ReturnType<typeof setTimeout> | null = null;

/**
 * El botón «Atrás» del celular cierra el modal en vez de salir de la página.
 * Al activarse añade una entrada al historial; `popstate` llama a `onCerrar`.
 * Si el modal se cierra por otro medio, retrocede esa entrada.
 */
export function useCerrarConAtras(activo: boolean, onCerrar: () => void) {
  useEffect(() => {
    if (!activo) return;
    if (retroceso) {
      clearTimeout(retroceso);
      retroceso = null;
    } else {
      window.history.pushState({ [MARCA]: true }, '');
    }
    let porAtras = false;
    const alVolver = () => {
      porAtras = true;
      onCerrar();
    };
    window.addEventListener('popstate', alVolver);
    return () => {
      window.removeEventListener('popstate', alVolver);
      if (porAtras) return;
      retroceso = setTimeout(() => {
        retroceso = null;
        if ((window.history.state as Record<string, unknown> | null)?.[MARCA]) window.history.back();
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo]);
}
