import type { CatalogField, CatalogOption, FieldType } from './catalog.types';

type Extra = Partial<
  Pick<
    CatalogField,
    'maxLen' | 'porDefecto' | 'soloManual' | 'sufijo' | 'radio'
  >
>;

const mk = (
  tipo: FieldType,
  clave: string,
  etiqueta: string,
  seccion: string,
  pdf: string | string[],
  pista: string,
  extra: Extra = {},
): CatalogField => ({
  clave,
  etiqueta,
  seccion,
  tipo,
  pdfCampos: Array.isArray(pdf) ? pdf : [pdf],
  pista,
  ...extra,
});

type Args = [
  clave: string,
  etiqueta: string,
  seccion: string,
  pdf: string | string[],
  pista: string,
  extra?: Extra,
];

export const texto = (...a: Args) => mk('texto', ...a);
export const largo = (...a: Args) => mk('texto_largo', ...a);
export const fecha = (...a: Args) => mk('fecha', ...a);
export const casilla = (...a: Args) => mk('casilla', ...a);

/** Option field: `opciones` are [valor, etiqueta, pdfCampo] triples. */
export function opcion(
  clave: string,
  etiqueta: string,
  seccion: string,
  opciones: [string, string, string][],
  pista: string,
  extra: Extra = {},
): CatalogField {
  const ops: CatalogOption[] = opciones.map(([valor, et, pdfCampo]) => ({
    valor,
    etiqueta: et,
    pdfCampo,
  }));
  return {
    clave,
    etiqueta,
    seccion,
    tipo: 'opcion',
    pdfCampos: [],
    pista,
    opciones: ops,
    ...extra,
  };
}

export const SI_NO = (si: string, no: string): [string, string, string][] => [
  ['si', 'Sí', si],
  ['no', 'No', no],
];
