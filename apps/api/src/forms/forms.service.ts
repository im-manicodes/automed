import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_PROVIDER, LlmTruncatedError } from '../llm/llm-provider.interface';
import type { LlmProvider } from '../llm/llm-provider.interface';
import {
  CATALOGS,
  aiFields,
  catalogToPdfValues,
  getCatalog,
  validateDraft,
} from './catalogs';
import type { CatalogField, DraftValues, FormCatalog } from './catalogs';
import { fillPdf } from './pdf-fill';
import { renderFormPreview } from './form-preview';

/** Plantillas PDF: apps/api/assets/formatos (igual de profundo desde src/forms y dist/forms). */
export const FORMATOS_DIR = join(__dirname, '..', '..', 'assets', 'formatos');

export const FORMS_SYSTEM_PROMPT = `Eres un asistente que llena formatos médicos a partir del resumen vigente de un hilo de correo sobre UN paciente.
Reglas:
- No inventes datos. Si el resumen no dice algo con claridad, devuelve null para ese campo.
- Casillas: true, false o null.
- Opciones: exactamente uno de los valores permitidos, o null.
- Fechas: formato AAAA-MM-DD, o null.
- Textos: breves, en español, sin saltos innecesarios.
- Si el resumen contiene las secciones «## Constantes» y «## Historial de eventos», úsalas como fuente preferente: Constantes para datos personales, antecedentes y actores; Historial de eventos para signos vitales, laboratorios, dosis y cirugías. Si no existen, usa todo el resumen.
- Devuelve SOLO un objeto JSON {"clave": valor o null} con las claves pedidas, sin explicaciones ni markdown.`;

export interface FormFieldDto {
  clave: string;
  etiqueta: string;
  seccion: string;
  tipo: CatalogField['tipo'];
  opciones?: { valor: string; etiqueta: string }[];
  maxLen?: number;
  soloManual: boolean;
}

export interface FormatDto {
  id: FormCatalog['id'];
  titulo: string;
  campos: FormFieldDto[];
}

export interface FormDraft {
  formato: string;
  valores: DraftValues;
  faltantes: string[];
  errores: string[];
}

export interface FormDraftResult extends FormDraft {
  guardado: boolean;
  desactualizado: boolean;
  camposEditados: string[];
}

export interface SavedDraft {
  existe: boolean;
  valores: DraftValues;
  desactualizado: boolean;
  actualizadoEn: Date | null;
  camposEditados: string[];
}

/** sha256 corto de las claves (ordenadas) del catálogo: detecta cambios de campos. */
export function catalogHash(catalog: FormCatalog): string {
  const keys = catalog.campos.map((c) => c.clave).sort();
  return createHash('sha256')
    .update(keys.join('\n'))
    .digest('hex')
    .slice(0, 16);
}

function asValues(v: unknown): DraftValues {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? { ...(v as DraftValues) }
    : {};
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function toFieldDto(c: CatalogField): FormFieldDto {
  return {
    clave: c.clave,
    etiqueta: c.etiqueta,
    seccion: c.seccion,
    tipo: c.tipo,
    ...(c.opciones
      ? {
          opciones: c.opciones.map((o) => ({
            valor: o.valor,
            etiqueta: o.etiqueta,
          })),
        }
      : {}),
    ...(c.maxLen !== undefined ? { maxLen: c.maxLen } : {}),
    soloManual: c.soloManual === true,
  };
}

function fieldPrompt(c: CatalogField): string {
  const tipo =
    c.tipo === 'casilla'
      ? 'true/false/null'
      : c.tipo === 'fecha'
        ? 'AAAA-MM-DD o null'
        : c.tipo === 'opcion'
          ? `uno de [${(c.opciones ?? []).map((o) => `"${o.valor}" (${o.etiqueta})`).join(', ')}] o null`
          : `texto${c.maxLen ? ` de máximo ${c.maxLen} caracteres` : ''} o null`;
  return `- ${c.clave} (${c.etiqueta}; ${tipo}): ${c.pista}`;
}

/** Extrae el primer objeto JSON de la respuesta del LLM (tolera cercos de código y texto extra). */
export function parseDraftJson(raw: string): unknown {
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(raw.slice(a, b + 1));
  } catch {
    return null;
  }
}

/**
 * Formatos PDF desde la síntesis. El borrador es UNA llamada al LLM con SOLO la síntesis
 * vigente y se guarda por (hilo, formato); el PDF se rellena con los valores que el usuario confirma.
 * Los logs llevan solo ids y conteos (nada de contenido de correos ni de pacientes).
 */
@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  listFormats(): FormatDto[] {
    return CATALOGS.map((c) => ({
      id: c.id,
      titulo: c.titulo,
      campos: c.campos.map(toFieldDto),
    }));
  }

  private catalog(formato: unknown): FormCatalog {
    const c = typeof formato === 'string' ? getCatalog(formato) : undefined;
    if (!c) throw new BadRequestException('Formato desconocido');
    return c;
  }

  private async currentSynthesis(threadId: string) {
    const t = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { id: true, status: true },
    });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    if (t.status === 'pendiente' || t.status === 'procesando')
      throw new ConflictException(
        'El ticket se está analizando. Espera a que termine.',
      );
    if (t.status === 'necesita_revision')
      throw new ConflictException('Resuelve las dudas del PDF primero.');
    if (t.status !== 'listo')
      throw new ConflictException(
        'Analiza el ticket antes de llenar un formato.',
      );
    const [syn] = await this.prisma.synthesis.findMany({
      where: { threadId },
      orderBy: { version: 'desc' },
      take: 1,
      select: { id: true, markdown: true },
    });
    if (!syn)
      throw new ConflictException('El ticket todavía no tiene resumen.');
    return syn;
  }

  /** Síntesis vigente de un hilo (sin exigir estado `listo`); para consultar lo guardado. */
  private async latestSynthesisId(threadId: string): Promise<string | null> {
    const t = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { id: true },
    });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    const [syn] = await this.prisma.synthesis.findMany({
      where: { threadId },
      orderBy: { version: 'desc' },
      take: 1,
      select: { id: true },
    });
    return syn?.id ?? null;
  }

  /** Ajusta lo guardado al catálogo actual: sin claves desconocidas; las nuevas quedan vacías. */
  private reconcile(
    catalog: FormCatalog,
    row: { valores: unknown; valoresIA: unknown; catalogHash: string },
  ): {
    valores: DraftValues;
    valoresIA: DraftValues;
  } {
    const valores = asValues(row.valores);
    const valoresIA = asValues(row.valoresIA);
    if (row.catalogHash === catalogHash(catalog)) return { valores, valoresIA };
    const known = new Set(catalog.campos.map((c) => c.clave));
    for (const k of Object.keys(valores)) if (!known.has(k)) delete valores[k];
    for (const k of Object.keys(valoresIA))
      if (!known.has(k)) delete valoresIA[k];
    return { valores, valoresIA };
  }

  private editados(valores: DraftValues, valoresIA: DraftValues): string[] {
    const keys = new Set([...Object.keys(valores), ...Object.keys(valoresIA)]);
    return [...keys].filter((k) => !sameValue(valores[k], valoresIA[k])).sort();
  }

  async getSaved(threadId: string, formato: unknown): Promise<SavedDraft> {
    const catalog = this.catalog(formato);
    const currentId = await this.latestSynthesisId(threadId);
    const row = await this.prisma.formDraft.findUnique({
      where: { threadId_formato: { threadId, formato: catalog.id } },
    });
    if (!row)
      return {
        existe: false,
        valores: {},
        desactualizado: false,
        actualizadoEn: null,
        camposEditados: [],
      };
    const { valores, valoresIA } = this.reconcile(catalog, row);
    return {
      existe: true,
      valores,
      desactualizado: currentId !== null && row.synthesisId !== currentId,
      actualizadoEn: row.updatedAt,
      camposEditados: this.editados(valores, valoresIA),
    };
  }

  /**
   * Primera vez: UNA llamada al LLM y se guarda. Con borrador y sin `actualizar`: lo guardado,
   * sin LLM. Con `actualizar`: nueva llamada y solo se reemplazan los campos no editados.
   */
  async draft(
    threadId: string,
    formato: unknown,
    opts: { actualizar?: boolean } = {},
  ): Promise<FormDraftResult> {
    const catalog = this.catalog(formato);
    const syn = await this.currentSynthesis(threadId);
    const campos = aiFields(catalog);
    const faltantesDe = (valores: DraftValues) =>
      campos
        .map((c) => c.clave)
        .filter(
          (k) =>
            valores[k] === undefined ||
            valores[k] === null ||
            valores[k] === '',
        );
    const where = { threadId_formato: { threadId, formato: catalog.id } };
    const prev = await this.prisma.formDraft.findUnique({ where });
    if (prev && opts.actualizar !== true) {
      const { valores, valoresIA } = this.reconcile(catalog, prev);
      return {
        formato: catalog.id,
        valores,
        faltantes: faltantesDe(valores),
        errores: [],
        guardado: true,
        desactualizado: prev.synthesisId !== syn.id,
        camposEditados: this.editados(valores, valoresIA),
      };
    }
    const user = `Resumen vigente del paciente:\n\n${syn.markdown}\n\nCampos a llenar (formato "${catalog.titulo}"):\n${campos
      .map(fieldPrompt)
      .join('\n')}\n\nResponde solo con el objeto JSON.`;
    let raw: string;
    try {
      raw = await this.llm.text(FORMS_SYSTEM_PROMPT, user, {
        maxTokens: 4000,
        task: 'evento',
        threadId,
      });
    } catch (e) {
      this.logger.warn(
        `Borrador de formato falló (hilo ${threadId}): ${e instanceof LlmTruncatedError ? 'respuesta cortada' : 'error del modelo'}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo preparar el borrador ahora. Intenta de nuevo en un momento.',
      );
    }
    const parsed = parseDraftJson(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.logger.warn(
        `Borrador de formato sin JSON válido (hilo ${threadId})`,
      );
      throw new ServiceUnavailableException(
        'No se pudo leer la respuesta de la IA. Intenta de nuevo.',
      );
    }
    // Solo claves que la IA puede llenar; las extras se descartan.
    const permitidas = new Set(campos.map((c) => c.clave));
    const filtrado: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>))
      if (permitidas.has(k)) filtrado[k] = v;
    const { valores: nuevos, errores } = validateDraft(catalog, filtrado);
    let modelo: string | null = null;
    try {
      modelo = await this.llm.modelFor('evento');
    } catch {
      modelo = null;
    }
    let finales: DraftValues = nuevos;
    if (prev) {
      // Fusión: solo se reemplaza lo que el usuario no editó (valor actual == propuesta anterior).
      const { valores: actuales, valoresIA: anteriores } = this.reconcile(
        catalog,
        prev,
      );
      finales = { ...actuales };
      for (const c of campos) {
        const k = c.clave;
        if (sameValue(actuales[k], anteriores[k])) {
          if (nuevos[k] === undefined) delete finales[k];
          else finales[k] = nuevos[k];
        }
      }
    }
    const data = {
      synthesisId: syn.id,
      catalogHash: catalogHash(catalog),
      valoresIA: nuevos as object,
      valores: finales as object,
      modelo,
    };
    await this.prisma.formDraft.upsert({
      where,
      create: { threadId, formato: catalog.id, ...data },
      update: data,
    });
    this.logger.log(
      `Borrador de ${catalog.id} (hilo ${threadId}, ${prev ? 'actualizado' : 'nuevo'}): ${Object.keys(finales).length} valores, ${faltantesDe(finales).length} faltantes`,
    );
    return {
      formato: catalog.id,
      valores: finales,
      faltantes: faltantesDe(finales),
      errores,
      guardado: true,
      desactualizado: false,
      camposEditados: this.editados(finales, nuevos),
    };
  }

  /** Guarda las ediciones del usuario sobre un borrador existente. */
  async saveEdits(
    threadId: string,
    formato: unknown,
    valores: unknown,
  ): Promise<SavedDraft> {
    const catalog = this.catalog(formato);
    if (!valores || typeof valores !== 'object' || Array.isArray(valores))
      throw new BadRequestException('Los valores deben ser un objeto');
    const currentId = await this.latestSynthesisId(threadId);
    const where = { threadId_formato: { threadId, formato: catalog.id } };
    const prev = await this.prisma.formDraft.findUnique({ where });
    if (!prev) throw new NotFoundException('Todavía no hay borrador guardado');
    const known = new Set(catalog.campos.map((c) => c.clave));
    const limpio = Object.fromEntries(
      Object.entries(valores as Record<string, unknown>).filter(([k]) =>
        known.has(k),
      ),
    );
    const { valores: ok, errores } = validateDraft(catalog, limpio);
    if (errores.length)
      throw new BadRequestException(
        `Hay valores no válidos: ${errores.join('; ')}`,
      );
    const row = await this.prisma.formDraft.update({
      where,
      data: { valores: ok },
    });
    const { valoresIA } = this.reconcile(catalog, prev);
    this.logger.log(
      `Borrador de ${catalog.id} guardado (hilo ${threadId}): ${Object.keys(ok).length} valores`,
    );
    return {
      existe: true,
      valores: ok,
      desactualizado: currentId !== null && prev.synthesisId !== currentId,
      actualizadoEn: row?.updatedAt ?? new Date(),
      camposEditados: this.editados(ok, valoresIA),
    };
  }

  /** Valida y rellena el PDF (compartido por descarga y vista previa). */
  private async fill(
    threadId: string,
    formato: unknown,
    valores: unknown,
  ): Promise<{
    catalog: FormCatalog;
    bytes: Uint8Array;
    nValores: number;
    missing: number;
  }> {
    const catalog = this.catalog(formato);
    if (!valores || typeof valores !== 'object' || Array.isArray(valores))
      throw new BadRequestException('Los valores deben ser un objeto');
    const t = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { id: true },
    });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    // Edición del usuario: se descartan claves desconocidas; valores inválidos son error.
    const known = new Set(catalog.campos.map((c) => c.clave));
    const limpio = Object.fromEntries(
      Object.entries(valores as Record<string, unknown>).filter(([k]) =>
        known.has(k),
      ),
    );
    const { valores: ok, errores } = validateDraft(catalog, limpio);
    if (errores.length)
      throw new BadRequestException(
        `Hay valores no válidos: ${errores.join('; ')}`,
      );
    let template: Uint8Array;
    try {
      template = new Uint8Array(
        await readFile(join(FORMATOS_DIR, catalog.archivo)),
      );
    } catch {
      this.logger.error(`Falta la plantilla PDF ${catalog.archivo}`);
      throw new ServiceUnavailableException(
        'No se encontró la plantilla del formato.',
      );
    }
    const { bytes, missing } = await fillPdf(
      template,
      catalogToPdfValues(catalog, ok),
    );
    return {
      catalog,
      bytes,
      nValores: Object.keys(ok).length,
      missing: missing.length,
    };
  }

  async render(
    threadId: string,
    formato: unknown,
    valores: unknown,
  ): Promise<{ bytes: Uint8Array; filename: string }> {
    const { catalog, bytes, nValores, missing } = await this.fill(
      threadId,
      formato,
      valores,
    );
    this.logger.log(
      `PDF ${catalog.id} (hilo ${threadId}): ${nValores} valores, ${missing} campos no encontrados`,
    );
    const fecha = new Date().toISOString().slice(0, 10);
    return { bytes, filename: `${catalog.id}-${fecha}.pdf` };
  }

  /** Vista previa: PDF llenado, aplanado en memoria y rasterizado. No usa IA ni guarda nada. */
  async preview(
    threadId: string,
    formato: unknown,
    valores: unknown,
  ): Promise<{ paginas: string[] }> {
    const { catalog, bytes, nValores } = await this.fill(
      threadId,
      formato,
      valores,
    );
    let pngs: Buffer[];
    try {
      pngs = await renderFormPreview(bytes);
    } catch {
      this.logger.error(
        `Vista previa de ${catalog.id} falló (hilo ${threadId})`,
      );
      throw new ServiceUnavailableException(
        'No se pudo preparar la vista previa. Intenta de nuevo.',
      );
    }
    this.logger.log(
      `Vista previa ${catalog.id} (hilo ${threadId}): ${nValores} valores, ${pngs.length} páginas`,
    );
    return {
      paginas: pngs.map((b) => `data:image/png;base64,${b.toString('base64')}`),
    };
  }
}
