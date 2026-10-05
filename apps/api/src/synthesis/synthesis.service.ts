import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { ThreadSynthesizer } from '../jobs/pipeline-hooks.interface';
import { LLM_PROVIDER } from '../llm/llm-provider.interface';
import type { LlmProvider } from '../llm/llm-provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import {
  BuiltInput,
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
  SAMPLE_THREAD_TEXT,
  SYSTEM_PROMPT,
  buildFinalPrompt,
  buildMapPrompt,
  buildReducePrompt,
} from './synthesis-prompts';

export interface SynthesisResult {
  /** true si no se llamó al LLM porque la entrada no cambió. */
  skipped: boolean;
  version: number;
  status: 'listo' | 'necesita_revision';
  doubtfulCount: number;
}

const MAP_MAX_TOKENS = 4000;
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
  private readonly maxInputTokens: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    config: ConfigService,
  ) {
    const n = Number(config.get<string>('SYNTH_MAX_INPUT_TOKENS'));
    this.maxInputTokens = Number.isFinite(n) && n >= 2000 ? n : 60000;
  }

  /** Enganche del pipeline (THREAD_SYNTHESIZER). */
  async synthesize(threadId: string, opts: { force?: boolean } = {}) {
    await this.generate(threadId, opts);
  }

  async generate(
    threadId: string,
    opts: { force?: boolean } = {},
  ): Promise<SynthesisResult> {
    const built = await this.loadInput(threadId);
    const template = await this.templates.getActive();
    const inputText = built.blocks.map((b) => b.text).join('\n\n');
    const inputHash = createHash('sha256')
      .update(`${PROMPT_VERSION}\n${template.markdown}\n---\n${inputText}`)
      .digest('hex');
    const status = built.doubtfulCount > 0 ? 'necesita_revision' : 'listo';

    const last = await this.prisma.synthesis.findFirst({
      where: { threadId },
      orderBy: { version: 'desc' },
    });
    if (last && last.inputHash === inputHash && !opts.force) {
      this.logger.log(
        `Síntesis sin cambios (hilo ${threadId}), no se llama al LLM`,
      );
      return {
        skipped: true,
        version: last.version,
        status,
        doubtfulCount: built.doubtfulCount,
      };
    }

    const markdown = await this.renderMarkdown(
      built.blocks.map((b) => b.text),
      template.markdown,
    );
    const version = (last?.version ?? 0) + 1;
    await this.prisma.synthesis.create({
      data: {
        threadId,
        version,
        markdown,
        inputHash,
        model: this.llm.modelText,
        templateId: template.id,
        templateVersion: template.version,
      },
    });
    return {
      skipped: false,
      version,
      status,
      doubtfulCount: built.doubtfulCount,
    };
  }

  /** Vista previa de una plantilla (activa o una propuesta) con un hilo de ejemplo. */
  async preview(markdown?: string) {
    const tpl = markdown?.trim() || (await this.templates.getActive()).markdown;
    const out = await this.llm.text(
      SYSTEM_PROMPT,
      buildFinalPrompt(tpl, SAMPLE_THREAD_TEXT, false),
    );
    return { markdown: stripFences(out) };
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
    return {
      threadId,
      status: thread.status,
      latest: latest
        ? {
            version: latest.version,
            markdown: latest.markdown,
            model: latest.model,
            templateVersion: latest.templateVersion,
            createdAt: latest.createdAt,
          }
        : null,
      history: [latest, ...older]
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({
          version: s.version,
          model: s.model,
          templateVersion: s.templateVersion,
          createdAt: s.createdAt,
        })),
    };
  }

  // ---- entrada ----

  async loadInput(threadId: string): Promise<BuiltInput> {
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
          text: r.text,
          status: r.status,
          userText: r.userText,
        })),
      });
      pagesBySha.set(p.sha256, list);
    }
    const messages: InputMessage[] = thread.messages.map((m) => ({
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
    return buildInputBlocks(messages, pagesBySha);
  }

  // ---- LLM ----

  /** Directo si cabe en el presupuesto; si no, map (por tramos) + reduce (combinar). */
  async renderMarkdown(blocks: string[], template: string): Promise<string> {
    const overhead =
      estimateTokens(template) +
      estimateTokens(SYSTEM_PROMPT) +
      PROMPT_OVERHEAD_TOKENS;
    const full = blocks.join('\n\n');
    if (estimateTokens(full) + overhead <= this.maxInputTokens) {
      return stripFences(
        await this.llm.text(
          SYSTEM_PROMPT,
          buildFinalPrompt(template, full, false),
        ),
      );
    }

    const chunkTokens = Math.max(
      1000,
      this.maxInputTokens - PROMPT_OVERHEAD_TOKENS,
    );
    const chunks = chunkBlocks(blocks, chunkTokens);
    this.logger.log(`Hilo largo: map-reduce en ${chunks.length} tramos`);
    let notes: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      notes.push(
        await this.llm.text(
          MAP_SYSTEM_PROMPT,
          buildMapPrompt(chunks[i], i + 1, chunks.length),
          { maxTokens: MAP_MAX_TOKENS },
        ),
      );
    }
    // reduce jerárquico hasta que las notas quepan junto con la plantilla
    const finalBudget = Math.max(1000, this.maxInputTokens - overhead);
    for (
      let level = 0;
      level < MAX_REDUCE_LEVELS &&
      notes.length > 1 &&
      estimateTokens(notes.join('\n\n')) > finalBudget;
      level++
    ) {
      const groups = chunkBlocks(notes, chunkTokens);
      if (groups.length >= notes.length) break;
      const reduced: string[] = [];
      for (const g of groups) {
        reduced.push(
          await this.llm.text(REDUCE_SYSTEM_PROMPT, buildReducePrompt([g]), {
            maxTokens: MAP_MAX_TOKENS,
          }),
        );
      }
      notes = reduced;
    }
    return stripFences(
      await this.llm.text(
        SYSTEM_PROMPT,
        buildFinalPrompt(template, notes.join('\n\n'), true),
      ),
    );
  }
}
