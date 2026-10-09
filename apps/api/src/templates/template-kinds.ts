import {
  DEFAULT_TEMPLATE_MARKDOWN,
  DEFAULT_TEMPLATE_NAME,
  MAX_TEMPLATE_CHARS,
  MIN_TEMPLATE_CHARS,
  validateTemplateMarkdown,
} from './default-template';
import {
  DEFAULT_REPORT_TEMPLATE_MARKDOWN,
  DEFAULT_REPORT_TEMPLATE_NAME,
  MAX_REPORT_TEMPLATE_CHARS,
  validateReportTemplate,
} from './report-columns';

/** Tipos de plantilla que usa la IA. Para añadir uno: agregarlo aquí y a `TEMPLATE_KINDS`. */
export type TemplateKind = 'resumen' | 'whatsapp' | 'reporte';

export const DEFAULT_TEMPLATE_KIND: TemplateKind = 'resumen';

export interface TemplateKindDef {
  kind: TemplateKind;
  /** Nombre visible en la UI. */
  label: string;
  defaultName: string;
  defaultMarkdown: string;
  minChars: number;
  maxChars: number;
  /** Texto de ayuda para la UI. */
  help: string;
  /** Devuelve un mensaje de error en español o null si es válida. */
  validate: (markdown: unknown) => string | null;
}

export const DEFAULT_WHATSAPP_TEMPLATE_NAME = 'Formato de WhatsApp estándar';

export const DEFAULT_WHATSAPP_TEMPLATE_MARKDOWN = `*{NOMBRE APELLIDOS}* · {N} años · _{UCI o Hab.}_ · Ingreso {dd/mm}

*Diagnóstico:* {diagnóstico o PO con su fecha}

*Evolución {dd/mm}:*
{evolución más reciente en texto corrido}
\`TA {…}\` \`FC {…}\` \`FR {…}\` \`T {…}\` \`SatO2 {…}\`

*Estudios:* \`{estudio: cifra}\` \`{estudio: cifra}\`

*Pendientes:*
• {pendiente}
• {pendiente}

<!-- Todo lo que está entre llaves {…} es un MARCADOR: reemplázalo con datos del correo o sus adjuntos. PROHIBIDO copiar los marcadores {…} literalmente y PROHIBIDO inventar valores: usa solo lo que aparezca en el correo. -->
<!-- Si no hay dato para una línea o sección completa (diagnóstico, signos vitales, estudios, pendientes...), OMÍTELA. No escribas "No indicado" ni listes los campos que faltan. Si falta un dato clave, a lo sumo UNA línea final: _Falta: ..._ -->
<!-- Formato WhatsApp: *negrita* para nombres y títulos, _cursiva_ para ubicación o aclaraciones, \`código\` para cifras (signos vitales, laboratorios, dosis, estudios), "• " para viñetas. Separa las secciones con una línea en blanco. -->
<!-- Si el paciente fue dado de alta, usa un bloque corto: "*{NOMBRE APELLIDOS}* — _Alta por mejoría_" y debajo el tratamiento indicado. -->
<!-- Si hay varios pacientes, un bloque por paciente separado por una línea en blanco. Español sencillo y directo. -->
`;

export const MAX_WHATSAPP_TEMPLATE_CHARS = 3000;

/** Valida el formato de WhatsApp: texto libre (sin exigir encabezados #), con límites propios. */
export function validateWhatsappTemplate(markdown: unknown): string | null {
  if (typeof markdown !== 'string') return 'La plantilla debe ser texto';
  const t = markdown.trim();
  if (t.length < MIN_TEMPLATE_CHARS) return 'La plantilla es demasiado corta';
  if (t.length > MAX_WHATSAPP_TEMPLATE_CHARS)
    return `La plantilla supera ${MAX_WHATSAPP_TEMPLATE_CHARS} caracteres`;
  return null;
}

export const TEMPLATE_KINDS: Record<TemplateKind, TemplateKindDef> = {
  resumen: {
    kind: 'resumen',
    label: 'Resumen del ticket',
    defaultName: DEFAULT_TEMPLATE_NAME,
    defaultMarkdown: DEFAULT_TEMPLATE_MARKDOWN,
    minChars: MIN_TEMPLATE_CHARS,
    maxChars: MAX_TEMPLATE_CHARS,
    help: 'Estructura de la síntesis de cada ticket. Escribe las secciones con ## y tus instrucciones dentro de <!-- comentarios -->.',
    validate: validateTemplateMarkdown,
  },
  whatsapp: {
    kind: 'whatsapp',
    label: 'Mensaje de WhatsApp',
    defaultName: DEFAULT_WHATSAPP_TEMPLATE_NAME,
    defaultMarkdown: DEFAULT_WHATSAPP_TEMPLATE_MARKDOWN,
    minChars: MIN_TEMPLATE_CHARS,
    maxChars: MAX_WHATSAPP_TEMPLATE_CHARS,
    help: 'Formato del mensaje de WhatsApp del último correo (un bloque por paciente). Usa marcas de WhatsApp: *negrita*, _cursiva_, `código` (para cifras) y • viñetas. Pon {marcadores} donde va cada dato (nunca valores de ejemplo reales) y tus instrucciones dentro de <!-- comentarios -->.',
    validate: validateWhatsappTemplate,
  },
  reporte: {
    kind: 'reporte',
    label: 'Reporte Excel',
    defaultName: DEFAULT_REPORT_TEMPLATE_NAME,
    defaultMarkdown: DEFAULT_REPORT_TEMPLATE_MARKDOWN,
    minChars: 1,
    maxChars: MAX_REPORT_TEMPLATE_CHARS,
    help: 'Columnas del Excel diario de pacientes hospitalizados. Una viñeta por columna: "- Nombre: instrucción para la IA" (de 1 a 30 columnas, sin nombres repetidos).',
    validate: validateReportTemplate,
  },
};

export function isTemplateKind(v: unknown): v is TemplateKind {
  return (
    typeof v === 'string' &&
    Object.prototype.hasOwnProperty.call(TEMPLATE_KINDS, v)
  );
}

/** Normaliza `?kind=`: vacío -> 'resumen'; desconocido -> null (el llamador responde 400). */
export function parseTemplateKind(v: unknown): TemplateKind | null {
  if (v === undefined || v === null || v === '') return DEFAULT_TEMPLATE_KIND;
  return isTemplateKind(v) ? v : null;
}
