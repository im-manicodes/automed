/**
 * Plantilla por defecto (español). Cada sección lleva sus instrucciones en un comentario HTML
 * `<!-- ... -->`: el modelo las sigue pero NO las copia a la salida.
 */
export const DEFAULT_TEMPLATE_NAME = 'Plantilla estándar';

export const DEFAULT_TEMPLATE_MARKDOWN = `# Asunto
<!-- Asunto del hilo en una línea. -->

## Participantes
<!-- Lista: nombre o correo y su rol aparente. Indica quién soy yo (mensajes propios). -->

## Resumen ejecutivo
<!-- 3 a 6 líneas: de qué trata, estado actual y qué sigue. -->

## Línea de tiempo
<!-- Una viñeta por hecho relevante, en orden cronológico: **fecha** — quién — qué pasó. -->

## Decisiones
<!-- Decisiones tomadas y quién las tomó. Si no hay, escribe "Sin decisiones registradas". -->

## Acciones pendientes
<!-- Tabla markdown con columnas: Acción | Responsable | Fecha límite. Escribe "No indicado" si falta un dato. -->

## Fechas y montos relevantes
<!-- Lista de fechas, plazos, importes y cifras mencionadas, con su contexto y fuente (correo o documento). -->

## Contenido de adjuntos
<!-- Un subapartado "### {nombre del documento}" por cada adjunto, con lo esencial de su contenido. Si hay marcas [ilegible #n · documento · p.k], consérvalas tal cual. -->

## Dudas por aclarar
<!-- Preguntas abiertas, datos contradictorios o partes ilegibles que requieren confirmación. -->
`;

export const MAX_TEMPLATE_CHARS = 20000;
export const MIN_TEMPLATE_CHARS = 20;

/** Valida tamaño y forma: texto con al menos un encabezado de sección (# o ##). */
export function validateTemplateMarkdown(markdown: unknown): string | null {
  if (typeof markdown !== 'string') return 'La plantilla debe ser texto';
  const t = markdown.trim();
  if (t.length < MIN_TEMPLATE_CHARS) return 'La plantilla es demasiado corta';
  if (t.length > MAX_TEMPLATE_CHARS)
    return `La plantilla supera ${MAX_TEMPLATE_CHARS} caracteres`;
  if (!/^#{1,3}\s+\S/m.test(t))
    return 'La plantilla debe tener al menos una sección con título (## Título)';
  return null;
}
