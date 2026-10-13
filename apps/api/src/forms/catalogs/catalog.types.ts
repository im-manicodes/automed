export type FieldType =
  'texto' | 'texto_largo' | 'fecha' | 'casilla' | 'opcion';

export interface CatalogOption {
  valor: string;
  etiqueta: string;
  /** Checkbox name, or the radio option name when the field has `radio`. */
  pdfCampo: string;
}

export interface CatalogField {
  /** Stable snake_case key. */
  clave: string;
  /** Plain Spanish label shown to the user. */
  etiqueta: string;
  seccion: string;
  tipo: FieldType;
  /** Exact PDF field names (several when the field is mirrored; for `fecha` with 3 names: [día, mes, año]). */
  pdfCampos: string[];
  /** Short instruction for the AI: what to look for in the medical synthesis. '' = AI never fills it. */
  pista: string;
  maxLen?: number;
  /** Only for tipo 'opcion'. */
  opciones?: CatalogOption[];
  /** Name of the PDF radio group when the options are radio values (not checkboxes). */
  radio?: string;
  /** Factory value of the template that is kept when the value is null/undefined (otherwise it is emptied). */
  porDefecto?: string | boolean;
  /** Fixed/administrative data or signatures: the AI must not fill it. */
  soloManual?: boolean;
  /** Fixed text appended after a non-empty value (printed legend inside a big text field). */
  sufijo?: string;
}

export interface FormCatalog {
  id: 'visita-directiva' | 'ingreso-pemex' | 'cirugia-f03';
  titulo: string;
  archivo: string;
  campos: CatalogField[];
}

export type DraftValue = string | boolean | null;
export type DraftValues = Record<string, DraftValue>;

/** Names the catalog writes to in the PDF (checkbox names, radio group names, text fields). */
export function catalogPdfNames(catalog: FormCatalog): Set<string> {
  const names = new Set<string>();
  for (const c of catalog.campos) {
    for (const n of c.pdfCampos) names.add(n);
    for (const o of c.opciones ?? []) names.add(c.radio ?? o.pdfCampo);
  }
  return names;
}

/** Fields the AI may fill (not manual-only and with a hint). */
export function aiFields(catalog: FormCatalog): CatalogField[] {
  return catalog.campos.filter((c) => !c.soloManual && c.pista.trim() !== '');
}

function formatDate(iso: string, campos: string[]): Record<string, string> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return Object.fromEntries(campos.map((n) => [n, '']));
  const [, y, mo, d] = m;
  if (campos.length === 3)
    return { [campos[0]]: d, [campos[1]]: mo, [campos[2]]: y };
  return { [campos[0]]: `${d}/${mo}/${y}` };
}

/**
 * Pure: turns catalog values (by `clave`) into PDF field values (by PDF name).
 * null/undefined -> keeps `porDefecto` when set, otherwise empties the factory value.
 * For a shared radio group the first chosen option wins.
 */
export function catalogToPdfValues(
  catalog: FormCatalog,
  valores: Record<string, string | boolean | null | undefined>,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const c of catalog.campos) {
    const raw = valores[c.clave];
    const empty = raw === null || raw === undefined;
    switch (c.tipo) {
      case 'casilla': {
        const v = empty ? c.porDefecto === true : raw === true;
        for (const n of c.pdfCampos) out[n] = v;
        break;
      }
      case 'opcion': {
        const chosen =
          typeof raw === 'string' && raw !== ''
            ? raw
            : empty && typeof c.porDefecto === 'string'
              ? c.porDefecto
              : '';
        for (const o of c.opciones ?? []) {
          if (c.radio) {
            if (o.valor === chosen) {
              if (!out[c.radio]) out[c.radio] = o.pdfCampo;
            } else if (out[c.radio] === undefined) out[c.radio] = '';
          } else {
            out[o.pdfCampo] = o.valor === chosen;
          }
        }
        break;
      }
      case 'fecha': {
        const iso =
          typeof raw === 'string' && raw !== ''
            ? raw
            : empty && typeof c.porDefecto === 'string'
              ? c.porDefecto
              : '';
        Object.assign(out, formatDate(iso, c.pdfCampos));
        break;
      }
      default: {
        let text: string;
        if (empty) text = typeof c.porDefecto === 'string' ? c.porDefecto : '';
        else {
          text = typeof raw === 'string' ? raw : '';
          if (text !== '' && c.sufijo) text += c.sufijo;
        }
        for (const n of c.pdfCampos) out[n] = text;
      }
    }
  }
  return out;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (
    d.getUTCFullYear() === +m[1] &&
    d.getUTCMonth() === +m[2] - 1 &&
    d.getUTCDate() === +m[3]
  );
}

/**
 * Validates a raw draft (e.g. LLM output or user edits). Unknown keys are discarded
 * (and reported); invalid values are dropped and reported in `errores`.
 */
export function validateDraft(
  catalog: FormCatalog,
  raw: unknown,
): { valores: DraftValues; errores: string[] } {
  const valores: DraftValues = {};
  const errores: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valores, errores: ['El borrador debe ser un objeto'] };
  }
  const byKey = new Map(catalog.campos.map((c) => [c.clave, c]));
  for (const [clave, v] of Object.entries(raw as Record<string, unknown>)) {
    const c = byKey.get(clave);
    if (!c) {
      errores.push(`Campo desconocido: ${clave}`);
      continue;
    }
    if (v === null || v === undefined) {
      valores[clave] = null;
      continue;
    }
    switch (c.tipo) {
      case 'casilla':
        if (typeof v === 'boolean') valores[clave] = v;
        else errores.push(`${clave}: debe ser verdadero o falso`);
        break;
      case 'opcion':
        if (
          typeof v === 'string' &&
          (v === '' || (c.opciones ?? []).some((o) => o.valor === v))
        )
          valores[clave] = v === '' ? null : v;
        else errores.push(`${clave}: opción no válida`);
        break;
      case 'fecha':
        if (typeof v === 'string' && (v === '' || validIsoDate(v)))
          valores[clave] = v === '' ? null : v;
        else errores.push(`${clave}: fecha no válida (AAAA-MM-DD)`);
        break;
      default:
        if (typeof v !== 'string') errores.push(`${clave}: debe ser texto`);
        else if (c.maxLen !== undefined && v.length > c.maxLen)
          errores.push(`${clave}: máximo ${c.maxLen} caracteres`);
        else valores[clave] = v;
    }
  }
  return { valores, errores };
}
