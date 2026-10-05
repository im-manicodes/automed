import type { ApiPage, ApiPagesResponse, Duda } from './types';

/** Dudas (regiones 'dudoso' al cargar) ordenadas por página y luego por posición (arriba->abajo, izquierda->derecha). */
export function construirDudas(pages: ApiPage[]): Duda[] {
  const out: Duda[] = [];
  for (const p of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    const regs = p.regions
      .filter((r) => r.status === 'dudoso')
      .sort((a, b) => a.y - b.y || a.x - b.x);
    for (const r of regs) {
      out.push({
        id: r.id,
        pageNumber: p.pageNumber,
        bbox: { x: r.x, y: r.y, w: r.w, h: r.h },
        sugerencia: (r.text ?? '').trim(),
        textoGuardado: r.textoUsuario,
      });
    }
  }
  return out;
}

export function paginaDe(resp: ApiPagesResponse, pageNumber: number): ApiPage | undefined {
  return resp.pages.find((p) => p.pageNumber === pageNumber);
}

export type EstadoDuda = 'pendiente' | 'guardada' | 'omitida';

export interface Flujo {
  indice: number;
  estados: Record<string, EstadoDuda>;
}

export function flujoInicial(dudas: Duda[]): Flujo {
  const estados: Record<string, EstadoDuda> = {};
  for (const d of dudas) estados[d.id] = 'pendiente';
  return { indice: 0, estados };
}

export function totalGuardadas(f: Flujo): number {
  return Object.values(f.estados).filter((e) => e === 'guardada').length;
}

export function totalPendientes(f: Flujo): number {
  return Object.values(f.estados).filter((e) => e !== 'guardada').length;
}

export function irA(f: Flujo, dudas: Duda[], indice: number): Flujo {
  if (dudas.length === 0) return f;
  return { ...f, indice: Math.min(dudas.length - 1, Math.max(0, indice)) };
}

export function anterior(f: Flujo, dudas: Duda[]): Flujo {
  return irA(f, dudas, f.indice - 1);
}

export function marcar(f: Flujo, id: string, estado: EstadoDuda): Flujo {
  return { ...f, estados: { ...f.estados, [id]: estado } };
}

/**
 * Siguiente duda no guardada después de `desde`; si no hay, da la vuelta al principio.
 * Devuelve null si todas están guardadas.
 */
export function siguientePendiente(f: Flujo, dudas: Duda[], desde: number): number | null {
  const n = dudas.length;
  for (let k = 1; k <= n; k++) {
    const i = (desde + k) % n;
    if (f.estados[dudas[i].id] !== 'guardada') return i;
  }
  return null;
}

/** Avanza tras guardar/omitir. `terminado` es true cuando todo quedó guardado; `soloOmitidas` cuando ya no hay más después pero quedan omitidas. */
export function avanzar(f: Flujo, dudas: Duda[]): { flujo: Flujo; terminado: boolean } {
  const sig = siguientePendiente(f, dudas, f.indice);
  if (sig === null) return { flujo: f, terminado: true };
  return { flujo: { ...f, indice: sig }, terminado: false };
}
