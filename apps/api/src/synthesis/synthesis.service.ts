import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { ThreadSynthesizer } from '../jobs/pipeline-hooks.interface';
import { parseReportColumns } from '../templates/report-columns';
import { AiSettingsService } from '../settings/ai-settings.service';
import { LLM_PROVIDER, LlmTruncatedError } from '../llm/llm-provider.interface';
import type { LlmProvider } from '../llm/llm-provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import { sanearParaWhatsApp } from './whatsapp-format';
import { TemplatesService } from '../templates/templates.service';
import type { TemplateKind } from '../templates/template-kinds';
import {
  buildInputBlocks,
  chunkBlocks,
  estimateTokens,
  InputMessage,
  InputPage,
} from './thread-input';
import {
  MAP_SYSTEM_PROMPT,
  PROMPT_VERSION,
  REDUCE_SYSTEM_PROMPT,
  INCREMENTAL_PROMPT_VERSION,
  INCREMENTAL_SYSTEM_PROMPT,
  SAMPLE_THREAD_TEXT,
  SYSTEM_PROMPT,
  buildIncrementalPrompt,
  buildFinalPrompt,
  buildMapPrompt,
  buildReducePrompt,
  buildWhatsappPrompt,
  SAMPLE_WHATSAPP_SUMMARY_TEXT,
  WHATSAPP_SYSTEM_PROMPT,
} from './synthesis-prompts';

export interface SynthesisResult {
  /** true si no se llamó al LLM porque la entrada no cambió / no hay novedades. */
  skipped: boolean;
  version: number;
  status: 'listo' | 'necesita_revision';
  doubtfulCount: number;
  mode: 'full' | 'incremental';
  /** Tokens estimados enviados al LLM en esta ejecución (0 si se omitió). */
  inputTokensEstimados: number;
}

export interface GenerateOptions {
  /** Regenerar desde cero (modo completo). */
  force?: boolean;
  /** sha256 del adjunto cuyas regiones corrigió el usuario (actualización incremental dirigida). */
  correctedSha256?: string;
  /**
   * Re-analizar un correo ya cubierto: se trata como NUEVO (sale de la cobertura previa), de modo
   * que al LLM van la síntesis anterior + ese correo con el OCR de sus adjuntos. Nunca el hilo completo.
   */
  reanalyzeMessageId?: string;
}

interface ThreadData {
  messages: InputMessage[];
  pagesBySha: Map<string, InputPage[]>;
}

const MAP_MAX_TOKENS = 4000;
const TRUNCATED_MESSAGE =
  'El resumen salió más largo de lo que permite el modelo. Pide a quien administra que suba la longitud máxima de salida o vuelve a intentarlo.';
const MAX_REDUCE_LEVELS = 4;
/** Reserva para instrucciones de los prompts de map/reduce. */
const PROMPT_OVERHEAD_TOKENS = 1500;

/** Quita el bloque ```markdown ... ``` que algunos modelos añaden alrededor de la salida. */
export function stripFences(s: string): string {
  const m = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i.exec(s.trim());
  return (m ? m[1] : s).trim();
}

@Injectable()
export class SynthesisService implements ThreadSynthesizer {
  private readonly logger = new Logger(SynthesisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly aiSettings: AiSettingsService,
  ) {}

  /** Máximo de tokens de entrada vigente (panel > SYNTH_MAX_INPUT_TOKENS), leído por llamada. */
  private async maxInputTokens(): Promise<number> {
    return (await this.aiSettings.getEffective()).maxInputTokens;
  }

  /** Enganche del pipeline (THREAD_SYNTHESIZER). */
  async synthesize(threadId: string, opts: GenerateOptions = {}) {
    await this.generate(threadId, opts);
  }

  /**
   * Genera una versión nueva de la síntesis.
   * - Incremental: hay síntesis previa utilizable (cubre mensajes conocidos y tiene texto) y no se
   *   fuerza. Al LLM solo van: plantilla, síntesis anterior y las novedades (mensajes no cubiertos
   *   con el OCR de SUS adjuntos, o el documento corregido). Nunca el hilo completo.
   * - Completo: sin síntesis previa utilizable, o `force` (regenerate explícito).
   * Un cambio de plantilla NO dispara regeneración: el incremental sigue con la plantilla con la
   * que se escribió el markdown anterior y `getForThread` avisa `plantillaDesactualizada`.
   */
  async generate(
    threadId: string,
    opts: GenerateOptions = {},
  ): Promise<SynthesisResult> {
    const data = await this.loadThreadData(threadId);
    const built = buildInputBlocks(data.messages, data.pagesBySha);
    const template = await this.templates.getActive('resumen');
    const status = built.doubtfulCount > 0 ? 'necesita_revision' : 'listo';
    const allIds = data.messages.map((m) => m.id as string);
    const last = await this.prisma.synthesis.findFirst({
      where: { threadId },
      orderBy: { version: 'desc' },
    });
    const covered = new Set(coveredIds(last?.coveredMessageIds));
    const usable = !!last && covered.size > 0 && last.markdown.trim() !== '';
    const reanalyzeId =
      opts.reanalyzeMessageId && allIds.includes(opts.reanalyzeMessageId)
        ? opts.reanalyzeMessageId
        : undefined;
    if (reanalyzeId) covered.delete(reanalyzeId);
    const meter = { tokens: 0 };

    // ---- incremental ----
    if (last && usable && !opts.force) {
      const newIds = new Set(allIds.filter((id) => !covered.has(id)));
      const updateBlocks = built.blocks.filter(
        (b) =>
          (b.messageId && newIds.has(b.messageId)) ||
          (opts.correctedSha256 &&
            b.kind === 'document' &&
            b.sha256 === opts.correctedSha256 &&
            !b.duplicate),
      );
      if (updateBlocks.length === 0) {
        this.logger.log(
          `Síntesis sin novedades (hilo ${threadId}), no se llama al LLM`,
        );
        return {
          skipped: true,
          version: last.version,
          status,
          doubtfulCount: built.doubtfulCount,
          mode: last.mode === 'incremental' ? 'incremental' : 'full',
          inputTokensEstimados: 0,
        };
      }
      const correctionOnly = newIds.size === 0 && !reanalyzeId;
      const tpl = await this.templateFor(last, template);
      const updatesText = updateBlocks.map((b) => b.text).join('\n\n');
      const inputHash = createHash('sha256')
        .update(
          `${INCREMENTAL_PROMPT_VERSION}\n${tpl.markdown}\n---\n${last.markdown}\n---\n${updatesText}`,
        )
        .digest('hex');
      if (last.inputHash === inputHash && !reanalyzeId) {
        return {
          skipped: true,
          version: last.version,
          status,
          doubtfulCount: built.doubtfulCount,
          mode: last.mode === 'incremental' ? 'incremental' : 'full',
          inputTokensEstimados: 0,
        };
      }
      const markdown = await this.renderIncremental(
        updateBlocks.map((b) => b.text),
        last.markdown,
        tpl.markdown,
        correctionOnly,
        meter,
      );
      const version = last.version + 1;
      await this.prisma.synthesis.create({
        data: {
          threadId,
          version,
          markdown,
          inputHash,
          model: await this.llm.modelFor('resumen'),
          templateId: tpl.id,
          templateVersion: tpl.version,
          coveredMessageIds: allIds,
          mode: 'incremental',
          baseSynthesisId: last.id,
          inputTokensEstimados: meter.tokens,
        },
      });
      this.logger.log(
        `Síntesis v${version} (hilo ${threadId}): modo incremental, ~${meter.tokens} tokens de entrada, ${newIds.size} mensajes nuevos`,
      );
      return {
        skipped: false,
        version,
        status,
        doubtfulCount: built.doubtfulCount,
        mode: 'incremental',
        inputTokensEstimados: meter.tokens,
      };
    }

    // ---- completo ----
    const inputText = built.blocks.map((b) => b.text).join('\n\n');
    const inputHash = createHash('sha256')
      .update(`${PROMPT_VERSION}\n${template.markdown}\n---\n${inputText}`)
      .digest('hex');
    if (last && last.inputHash === inputHash && !opts.force) {
      this.logger.log(
        `Síntesis sin cambios (hilo ${threadId}), no se llama al LLM`,
      );
      return {
        skipped: true,
        version: last.version,
        status,
        doubtfulCount: built.doubtfulCount,
        mode: last.mode === 'incremental' ? 'incremental' : 'full',
        inputTokensEstimados: 0,
      };
    }

    const markdown = await this.renderMarkdown(
      built.blocks.map((b) => b.text),
      template.markdown,
      meter,
    );
    const version = (last?.version ?? 0) + 1;
    await this.prisma.synthesis.create({
      data: {
        threadId,
        version,
        markdown,
        inputHash,
        model: await this.llm.modelFor('resumen'),
        templateId: template.id,
        templateVersion: template.version,
        coveredMessageIds: allIds,
        mode: 'full',
        baseSynthesisId: null,
        inputTokensEstimados: meter.tokens,
      },
    });
    this.logger.log(
      `Síntesis v${version} (hilo ${threadId}): modo completo, ~${meter.tokens} tokens de entrada`,
    );
    return {
      skipped: false,
      version,
      status,
      doubtfulCount: built.doubtfulCount,
      mode: 'full',
      inputTokensEstimados: meter.tokens,
    };
  }

  /** Plantilla con la que se escribió la síntesis previa (para conservar su formato). */
  private async templateFor(
    last: { templateId: string | null },
    active: { id: string; version: number; markdown: string },
  ): Promise<{ id: string; version: number; markdown: string }> {
    if (!last.templateId || last.templateId === active.id) return active;
    const old = await this.prisma.template.findUnique({
      where: { id: last.templateId },
    });
    return old
      ? { id: old.id, version: old.version, markdown: old.markdown }
      : active;
  }

  /**
   * Vista previa de una plantilla (activa o una propuesta) del tipo dado con un ejemplo:
   * 'resumen' con un hilo de ejemplo; 'whatsapp' con un correo de ejemplo.
   */
  async preview(markdown?: string, kind: TemplateKind = 'resumen') {
    const tpl =
      markdown?.trim() || (await this.templates.getActive(kind)).markdown;
    if (kind === 'reporte') {
      // Sin LLM: solo muestra las columnas que se leyeron de la plantilla (o el error de formato).
      const { columnas, error } = parseReportColumns(tpl);
      return {
        markdown: columnas
          .map((c) => `- ${c.nombre}: ${c.instruccion}`)
          .join('\n'),
        columnas,
        error,
      };
    }
    if (kind === 'whatsapp') {
      const out = await this.llm.text(
        WHATSAPP_SYSTEM_PROMPT,
        buildWhatsappPrompt(tpl, SAMPLE_WHATSAPP_SUMMARY_TEXT),
        { maxTokens: 2000, task: 'whatsapp' },
      );
      return { markdown: sanearParaWhatsApp(stripFences(out)) };
    }
    const out = await this.llm.text(
      SYSTEM_PROMPT,
      buildFinalPrompt(tpl, SAMPLE_THREAD_TEXT, false),
      { task: 'resumen' },
    );
    return { markdown: stripFences(out) };
  }

  /**
   * Mensaje de WhatsApp con el status del paciente, redactado por el LLM SOLO con la síntesis
   * vigente del ticket (no reenvía el hilo ni los adjuntos) y el formato de la plantilla
   * `whatsapp`. Exige que el ticket ya tenga resumen. No guarda nada.
   */
  async whatsappLast(threadId: string): Promise<{ texto: string }> {
    const syn = await this.prisma.synthesis.findFirst({
      where: { threadId },
      orderBy: { version: 'desc' },
      select: { markdown: true },
    });
    if (!syn)
      throw new ConflictException(
        'Analiza el ticket antes de generar el mensaje.',
      );
    // Respeta SYNTH_MAX_INPUT_TOKENS: se recorta el resumen si no cabe.
    const maxChars = Math.max(
      2000,
      ((await this.maxInputTokens()) - PROMPT_OVERHEAD_TOKENS) * 4,
    );
    let body = syn.markdown;
    if (body.length > maxChars)
      body = body.slice(0, maxChars) + '\n[... recortado ...]';
    const tpl = await this.templates.getActive('whatsapp');
    let out: string;
    try {
      out = await this.llm.text(
        WHATSAPP_SYSTEM_PROMPT,
        buildWhatsappPrompt(tpl.markdown, body),
        { maxTokens: 2000, task: 'whatsapp' },
      );
    } catch (e) {
      this.logger.warn(
        `No se pudo redactar el mensaje de WhatsApp (hilo ${threadId}): ${(e as Error)?.name ?? 'error'}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo preparar el mensaje ahora. Intenta de nuevo en un momento.',
      );
    }
    const texto = sanearParaWhatsApp(stripFences(out));
    if (!texto)
      throw new ServiceUnavailableException(
        'No se pudo preparar el mensaje ahora. Intenta de nuevo en un momento.',
      );
    return { texto };
  }

  async getForThread(threadId: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId },
      select: { id: true, status: true },
    });
    if (!thread) throw new NotFoundException('Ticket no encontrado');
    const all = await this.prisma.synthesis.findMany({
      where: { threadId },
      orderBy: { version: 'desc' },
    });
    const [latest, ...older] = all;
    const active = await this.templates.getActive('resumen');
    return {
      threadId,
      status: thread.status,
      /** true si la plantilla activa es más nueva que la usada en la última síntesis. */
      plantillaDesactualizada:
        !!latest &&
        latest.templateVersion != null &&
        latest.templateVersion !== active.version,
      plantillaActivaVersion: active.version,
      latest: latest
        ? {
            version: latest.version,
            markdown: latest.markdown,
            model: latest.model,
            templateVersion: latest.templateVersion,
            mode: latest.mode,
            inputTokensEstimados: latest.inputTokensEstimados,
            mensajesCubiertos: coveredIds(latest.coveredMessageIds).length,
            createdAt: latest.createdAt,
          }
        : null,
      history: [latest, ...older]
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({
          version: s.version,
          model: s.model,
          templateVersion: s.templateVersion,
          mode: s.mode,
          inputTokensEstimados: s.inputTokensEstimados,
          createdAt: s.createdAt,
        })),
    };
  }

  // ---- entrada ----

  async loadThreadData(threadId: string): Promise<ThreadData> {
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId },
      include: {
        messages: {
          orderBy: { receivedAt: 'asc' },
          include: {
            attachments: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    if (!thread) throw new NotFoundException('Ticket no encontrado');
    const shas = [
      ...new Set(
        thread.messages.flatMap((m) => m.attachments.map((a) => a.sha256)),
      ),
    ];
    const pages = shas.length
      ? await this.prisma.ocrPage.findMany({
          where: { sha256: { in: shas } },
          orderBy: { pageNumber: 'asc' },
          include: { regions: true },
        })
      : [];
    const pagesBySha = new Map<string, InputPage[]>();
    for (const p of pages) {
      const list = pagesBySha.get(p.sha256) ?? [];
      if (list.some((x) => x.pageNumber === p.pageNumber)) continue;
      list.push({
        pageNumber: p.pageNumber,
        text: p.text,
        regions: p.regions.map((r) => ({
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          text: r.text,
          status: r.status,
          userText: r.userText,
        })),
      });
      pagesBySha.set(p.sha256, list);
    }
    const messages: InputMessage[] = thread.messages.map((m) => ({
      id: m.id,
      from: m.from,
      to: m.to,
      cc: m.cc,
      subject: m.subject,
      bodyText: m.bodyText,
      isFromMe: m.isFromMe,
      receivedAt: m.receivedAt,
      attachments: m.attachments.map((a) => ({
        sha256: a.sha256,
        filename: a.filename,
      })),
    }));
    return { messages, pagesBySha };
  }

  // ---- LLM ----

  /** Llama al LLM acumulando el tamaño estimado de entrada (sin registrar contenido). */
  private ask(
    meter: { tokens: number },
    system: string,
    user: string,
    opts?: { maxTokens?: number },
  ) {
    meter.tokens += estimateTokens(system) + estimateTokens(user);
    // failOnTruncate: una síntesis cortada nunca se guarda como si estuviera completa.
    return this.llm
      .text(system, user, { ...opts, task: 'resumen', failOnTruncate: true })
      .catch((e: unknown) => {
        if (e instanceof LlmTruncatedError) {
          // Sin contenido en logs; el mensaje llega a Job.lastError y el hilo pasa a 'error'.
          throw new LlmTruncatedError(TRUNCATED_MESSAGE);
        }
        throw e;
      });
  }

  /**
   * Devuelve los bloques tal cual si caben en `budget` tokens; si no, los condensa por tramos
   * (map) y combina (reduce jerárquico) hasta que quepan.
   */
  private async fit(
    blocks: string[],
    budget: number,
    meter: { tokens: number },
  ): Promise<{ text: string; mapped: boolean }> {
    const full = blocks.join('\n\n');
    if (estimateTokens(full) <= budget) return { text: full, mapped: false };

    const chunkTokens = Math.max(
      1000,
      (await this.maxInputTokens()) - PROMPT_OVERHEAD_TOKENS,
    );
    const chunks = chunkBlocks(blocks, chunkTokens);
    this.logger.log(`Entrada grande: map-reduce en ${chunks.length} tramos`);
    let notes: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      notes.push(
        await this.ask(
          meter,
          MAP_SYSTEM_PROMPT,
          buildMapPrompt(chunks[i], i + 1, chunks.length),
          { maxTokens: MAP_MAX_TOKENS },
        ),
      );
    }
    for (
      let level = 0;
      level < MAX_REDUCE_LEVELS &&
      notes.length > 1 &&
      estimateTokens(notes.join('\n\n')) > budget;
      level++
    ) {
      const groups = chunkBlocks(notes, chunkTokens);
      if (groups.length >= notes.length) break;
      const reduced: string[] = [];
      for (const g of groups) {
        reduced.push(
          await this.ask(meter, REDUCE_SYSTEM_PROMPT, buildReducePrompt([g]), {
            maxTokens: MAP_MAX_TOKENS,
          }),
        );
      }
      notes = reduced;
    }
    return { text: notes.join('\n\n'), mapped: true };
  }

  /** Modo completo: directo si cabe en el presupuesto; si no, map-reduce. */
  async renderMarkdown(
    blocks: string[],
    template: string,
    meter: { tokens: number } = { tokens: 0 },
  ): Promise<string> {
    const overhead =
      estimateTokens(template) +
      estimateTokens(SYSTEM_PROMPT) +
      PROMPT_OVERHEAD_TOKENS;
    const { text, mapped } = await this.fit(
      blocks,
      Math.max(1000, (await this.maxInputTokens()) - overhead),
      meter,
    );
    return stripFences(
      await this.ask(
        meter,
        SYSTEM_PROMPT,
        buildFinalPrompt(template, text, mapped),
      ),
    );
  }

  /**
   * Modo incremental: síntesis anterior + novedades. Si anterior + novedades exceden
   * SYNTH_MAX_INPUT_TOKENS, solo las novedades se condensan por tramos.
   */
  async renderIncremental(
    updateBlocks: string[],
    previousMarkdown: string,
    template: string,
    correction: boolean,
    meter: { tokens: number },
  ): Promise<string> {
    const overhead =
      estimateTokens(template) +
      estimateTokens(previousMarkdown) +
      estimateTokens(INCREMENTAL_SYSTEM_PROMPT) +
      PROMPT_OVERHEAD_TOKENS;
    const { text, mapped } = await this.fit(
      updateBlocks,
      Math.max(1000, (await this.maxInputTokens()) - overhead),
      meter,
    );
    return stripFences(
      await this.ask(
        meter,
        INCREMENTAL_SYSTEM_PROMPT,
        buildIncrementalPrompt(template, previousMarkdown, text, {
          mapped,
          correction,
        }),
      ),
    );
  }
}

/** Ids de mensajes cubiertos guardados en la columna JSON (tolerante a valores raros). */
export function coveredIds(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : [];
}
