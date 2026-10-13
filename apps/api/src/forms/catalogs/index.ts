import type { FormCatalog } from './catalog.types';
import { VISITA_DIRECTIVA } from './visita-directiva';
import { INGRESO_PEMEX } from './ingreso-pemex';
import { CIRUGIA_F03 } from './cirugia-f03';

export * from './catalog.types';

/** Order matters: Visita directiva, Ingreso PEMEX, Cirugía F03. */
export const CATALOGS: FormCatalog[] = [
  VISITA_DIRECTIVA,
  INGRESO_PEMEX,
  CIRUGIA_F03,
];

export function getCatalog(id: string): FormCatalog | undefined {
  return CATALOGS.find((c) => c.id === id);
}
