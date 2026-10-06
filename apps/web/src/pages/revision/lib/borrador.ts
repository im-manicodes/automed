/** Borradores de texto por duda: en memoria y, si se puede, en sessionStorage. Nunca lanza. */
export const MARCADOR_ILEGIBLE = '[ilegible]';

export interface AlmacenBorrador {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const PREFIJO = 'revision:borrador:';

export function crearBorradores(almacen?: AlmacenBorrador | null) {
  const memoria = new Map<string, string>();
  const seguro = <T,>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };
  return {
    leer(id: string): string | undefined {
      const m = memoria.get(id);
      if (m !== undefined) return m;
      const s = almacen ? seguro(() => almacen.getItem(PREFIJO + id)) : undefined;
      return s ?? undefined;
    },
    guardar(id: string, texto: string) {
      memoria.set(id, texto);
      if (almacen) seguro(() => almacen.setItem(PREFIJO + id, texto));
    },
    borrar(id: string) {
      memoria.delete(id);
      if (almacen) seguro(() => almacen.removeItem(PREFIJO + id));
    },
  };
}

/** Texto inicial del campo: borrador > texto ya guardado > sugerencia del OCR. */
export function textoInicial(borrador: string | undefined, guardado: string | null, sugerencia: string): string {
  return borrador ?? guardado ?? sugerencia;
}

/** Texto válido para enviar (la API rechaza vacío y >2000). */
export function textoEnviable(texto: string): string | null {
  const t = texto.trim();
  if (t === '' || t.length > 2000) return null;
  return t;
}
