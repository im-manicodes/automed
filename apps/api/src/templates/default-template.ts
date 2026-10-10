/**
 * Plantilla por defecto (español). Cada sección lleva sus instrucciones en un comentario HTML
 * `<!-- ... -->`: el modelo las sigue pero NO las copia a la salida.
 */
export const DEFAULT_TEMPLATE_NAME = 'Plantilla estándar';

export const DEFAULT_TEMPLATE_MARKDOWN = `<!-- Reglas generales (no se copian a la salida): no inventes datos; si un dato falta escribe "No indicado". No copies ruido del OCR o del manuscrito como si fuera un dato y nunca escribas "ilegible": usa solo lo que se entienda. Usa abreviaturas médicas habituales (APP, PO, SV, TA, FC, FR, SatO2) y fechas dd/mm/aa. -->

# Paciente
<!-- Tabla de dos columnas. Filas: Nombre (APELLIDOS NOMBRE), Edad, Sexo, Ficha / expediente, Codificación, Hospital / prestador, Región / localidad, Contrato / póliza, Aseguradora, Ubicación (UCI / Hab. / cama). "No indicado" si falta. -->
| Campo | Valor |
| --- | --- |
| Nombre (APELLIDOS NOMBRE) | |
| Edad | |
| Sexo | |
| Ficha / expediente | |
| Codificación | |
| Hospital / prestador | |
| Región / localidad | |
| Contrato / póliza | |
| Aseguradora | |
| Ubicación (UCI / Hab. / cama) | |

## Correos del hilo
<!-- Una viñeta por correo, en orden cronológico: fecha (dd/mm/aa hh:mm), quién escribe y qué pide o informa. Resume; no copies el correo completo. -->

## Ingreso y diagnóstico
<!-- Tabla | Campo | Valor | con: Fecha y hora de ingreso, Tipo de ingreso, Días de estancia, Estatus (activa / alta), Diagnósticos (con PO y su fecha si hubo cirugía), CIE-10, Especialidad, Tipo de manejo (médico o quirúrgico). -->
| Campo | Valor |
| --- | --- |
| Fecha y hora de ingreso | |
| Tipo de ingreso | |
| Días de estancia | |
| Estatus (activa / alta) | |
| Diagnósticos (PO y fecha) | |
| CIE-10 | |
| Especialidad | |
| Tipo de manejo (médico / quirúrgico) | |

## Evolución inicial (día 1)
<!-- Tabla | Campo | Valor | con: APP, Alergias, Padecimiento actual, SV de ingreso (TA, FC, FR, T, SatO2), Peso y talla, Exploración física, Estudios y laboratorios de ingreso. -->
| Campo | Valor |
| --- | --- |
| APP | |
| Alergias | |
| Padecimiento actual | |
| SV de ingreso | |
| Peso / talla | |
| Exploración | |
| Estudios y labs de ingreso | |

## Plan de manejo vigente
<!-- Lo vigente hoy. Subtítulos o viñetas: Dieta; Soluciones; Medicamentos IV (excepto antibióticos); Antibióticos (con fecha de inicio); Cuidados. -->

## Evolución por día
<!-- Una viñeta por fecha y hora (dd/mm/aa hh:mm), en orden cronológico: quién valora, SV (TA, FC, FR, T, SatO2), exploración, resultados, drenajes, sondas y gastos, procedimientos con su fecha y cambios de ubicación. -->

## Estudios y resultados
<!-- Laboratorios, imagen y otros estudios con cifras y fecha. -->

## Pendientes y en espera
<!-- Estudios, interconsultas, trámites o respuestas que faltan ("En espera de ..."). -->

## Alta o egreso
<!-- Fecha, motivo y tratamiento al egreso. Escribe "No aplica" si sigue internado. -->

## Gestión con aseguradora
<!-- Autorización o carta de garantía, montos y pendientes administrativos. -->

## Contenido de adjuntos
<!-- Esta sección es REPETIBLE: un bloque como el siguiente por cada página de cada adjunto, en orden. Cada bloque lleva sus cuatro apartados. -->

### {nombre del documento} · página {n}

#### Qué trata la página
<!-- 2 a 3 líneas: tipo de documento, fecha y quién lo emite. -->

#### Datos relevantes
<!-- Tabla | Sección | Campo | Valor | con UNA FILA por cada campo del formulario, también los vacíos (Valor "—"); solo datos que se entiendan. En "Sección" indica la parte del formulario donde está cada dato (encabezado, datos del paciente, nota pre/post operatoria, anestesia, cuentas, indicaciones...). Nunca uses viñetas aquí. -->
| Sección | Campo | Valor |
| --- | --- | --- |

#### Datos faltantes
<!-- Lista de campos vacíos o no indicados en la página. "Ninguno" si no hay. -->

#### Recreación de la página
<!-- Recrea la página SOLO con tablas markdown (celdas y columnas, sin viñetas): una tabla por cada sección del formulario (encabezado, datos del paciente, nota pre-operatoria, nota post-operatoria, anestesia, cuentas, indicaciones, etc.) con sus columnas reales, que respeten las mismas filas, columnas y orden del formulario original, usando la posición del texto (yNN% | xNN%) para ubicar cada dato. Casillas como [x] / [ ]. Texto largo dentro de la celda. No adivines ni completes lo que falta (déjalo con "—"). Si la página es digital y ya viene en markdown, cópiala y ordénala sin inventar nada. -->

## Dudas por aclarar
<!-- Preguntas abiertas o datos contradictorios que requieren confirmación (nunca problemas de lectura del documento). -->
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
