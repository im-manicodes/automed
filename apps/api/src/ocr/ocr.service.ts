import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { pageKey } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import type { AttachmentProcessor } from '../jobs/pipeline-hooks.interface';
import { classifyRegions, regionsOf } from './ocr-classifier';
import type { ClassifiedRegion } from './ocr-classifier';
import { flagLowConfidencePage } from './ocr-confidence';
import { OcrConfig, readOcrConfig } from './ocr-config';
import { OCR_ENGINE } from './ocr-engine.interface';
import type { OcrEngine } from './ocr-engine.interface';
import { PdfExtractClientService } from './pdf-extract-client.service';
import { PdfRasterizerService } from './pdf-rasterizer.service';
import { VISION_BATCH_SIZE, VisionRetryService } from './vision-retry.service';
import type { VisionReading } from './vision-retry.service';

/** Valor de OcrPage.engine para páginas digitales (texto del PDF -> markdown, sin OCR). */
export const PDF_TEXT_ENGINE = 'pdf-text';

export type StoredRegion = ClassifiedRegion & { source: 'ocr' | 'vision' };

/**
 * Implementación real de AttachmentProcessor (fase 4): PDF -> PNG por página (RustFS) ->
 * OcrEngine -> OcrPage/OcrRegion. Las páginas viven en UN solo Attachment por sha256; los
 * duplicados se resuelven consultando por sha256. No registra contenido en logs.
 */
@Injectable()
export class OcrService implements AttachmentProcessor {
  private readonly logger = new Logger(OcrService.name);
  private readonly cfg: OcrConfig;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly rasterizer: PdfRasterizerService,
    @Inject(OCR_ENGINE) private readonly engine: OcrEngine,
    private readonly vision: VisionRetryService,
    private readonly pdfText: PdfExtractClientService,
  ) {
    this.cfg = readOcrConfig(config);
  }

  async process(attachmentId: string): Promise<void> {
    const att = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });
    if (!att) return;
    // Dedupe: si ya hay páginas para este sha256 (en cualquier Attachment) no se repite.
    const existing = await this.prisma.ocrPage.count({
      where: { sha256: att.sha256 },
    });
    if (existing > 0) return;

    const pdf = await this.storage.get(att.storageKey);
    // Híbrido: las páginas con capa de texto se convierten a markdown sin OCR; el resto va a OCR.
    // Si el servicio no responde (o PDF_TEXT_MODE=off) -> null y todas las páginas pasan por OCR.
    const textPages = await this.pdfText.extract(pdf);
    const digital = new Map(
      (textPages ?? [])
        .filter((p) => p.kind === 'digital' && p.markdown.trim() !== '')
        .map((p) => [p.pageNumber, p.markdown]),
    );
    const rasters = await this.rasterizer.rasterize(pdf);
    const threadId = await this.threadIdOf(att.messageId);
    await this.writeProgress(threadId, { etapa: 'ocr' });

    const built: {
      pageNumber: number;
      width: number;
      height: number;
      text: string;
      engine: string;
      regions: StoredRegion[];
    }[] = [];
    for (const page of rasters) {
      await this.storage.put(
        pageKey(att.storageKey, page.pageNumber),
        page.png,
        'image/png',
      );
      const markdown = digital.get(page.pageNumber);
      if (markdown !== undefined) {
        built.push({
          pageNumber: page.pageNumber,
          width: page.width,
          height: page.height,
          text: markdown,
          engine: PDF_TEXT_ENGINE,
          regions: [],
        });
        continue;
      }
      const result = await this.engine.recognize(page.png, page.pageNumber);
      const lines = regionsOf(result);
      let regions: StoredRegion[] = classifyRegions(
        lines,
        this.cfg.confidenceThreshold,
      ).map((r) => ({ ...r, source: 'ocr' as const }));
      regions = await this.retryWithVision(page.png, regions, threadId);
      regions = flagLowConfidencePage(regions);
      built.push({
        pageNumber: page.pageNumber,
        width: page.width,
        height: page.height,
        text: lines.map((l) => l.text).join('\n'),
        engine: this.engine.name,
        regions,
      });
    }

    try {
      await this.prisma.$transaction(
        built.map((p) =>
          this.prisma.ocrPage.create({
            data: {
              attachmentId: att.id,
              sha256: att.sha256,
              pageNumber: p.pageNumber,
              imageKey: pageKey(att.storageKey, p.pageNumber),
              width: p.width,
              height: p.height,
              text: p.text,
              engine: p.engine,
              regions: {
                create: p.regions.map((r) => ({
                  x: r.box.x,
                  y: r.box.y,
                  w: r.box.w,
                  h: r.box.h,
                  text: r.text,
                  confidence: r.confidence,
                  status: r.status,
                  source: r.source,
                })),
              },
            },
          }),
        ),
      );
    } catch (e) {
      // P2002: otro worker guardó el mismo sha256 mientras tanto; el resultado ya existe.
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
    this.logger.log(
      `OCR listo: adjunto ${att.id}, ${built.length} páginas (${digital.size} digitales sin OCR), motor ${this.engine.name}`,
    );
  }

  /**
   * Relee con visión las regiones dudosas (si está habilitado); alta confianza -> ok.
   * Las zonas dudosas (hasta `getMaxRegions()` por página) van juntas en lotes de
   * `VISION_BATCH_SIZE` recortes por llamada; las que el lote no resuelve (omitidas,
   * `[ilegible]`, baja confianza o lote fallido) se reintentan UNA vez, también en lote, con el modelo `vision_respaldo`
   * (nunca recortes sueltos).
   * Lo que siga sin resolverse queda `dudoso`. Las regiones `ok` nunca se envían.
   */
  async retryWithVision(
    png: Uint8Array,
    regions: StoredRegion[],
    threadId?: string | null,
  ): Promise<StoredRegion[]> {
    if (!(await this.vision.isEnabled())) return regions;
    const budget = Math.max(await this.vision.getMaxRegions(), 0);
    const idx: number[] = [];
    regions.forEach((r, i) => {
      if (r.status === 'dudoso' && idx.length < budget) idx.push(i);
    });
    const total = idx.length;
    if (total === 0) return regions;

    await this.writeProgress(threadId, {
      etapa: 'vision_enviando',
      regiones: { total, hechas: 0 },
    });
    const out = [...regions];
    const threshold = this.vision.acceptThreshold;
    const accept = (i: number, reading: VisionReading | null): boolean => {
      if (!reading || reading.confidence < threshold) return false;
      out[i] = {
        ...regions[i],
        text: reading.text,
        confidence: reading.confidence,
        status: 'ok',
        source: 'vision',
      };
      return true;
    };

    let hechas = 0;
    // Una pasada en lote (trozos de VISION_BATCH_SIZE); devuelve las zonas no resueltas.
    const lote = async (
      indices: number[],
      task: 'vision' | 'vision_respaldo',
    ): Promise<number[]> => {
      const unresolved: number[] = [];
      for (let k = 0; k < indices.length; k += VISION_BATCH_SIZE) {
        const chunk = indices.slice(k, k + VISION_BATCH_SIZE);
        await this.writeProgress(threadId, {
          etapa: 'vision_procesando',
          regiones: { total, hechas },
        });
        let readings: (VisionReading | null)[] = [];
        try {
          readings = await this.vision.rereadBatch(
            png,
            chunk.map((i) => ({
              box: regions[i].box,
              ocrText: regions[i].text,
            })),
            task,
          );
        } catch {
          this.logger.warn(
            `Falló la relectura con visión en lote (${task}, ${chunk.length} zonas)`,
          );
        }
        chunk.forEach((i, j) => {
          if (!accept(i, readings[j] ?? null)) unresolved.push(i);
        });
        hechas += chunk.length;
      }
      return unresolved;
    };

    const pending = await lote(idx, 'vision');
    if (pending.length > 0) {
      this.logger.log(
        `Visión: ${pending.length} de ${total} zonas sin resolver; segundo intento en lote con el modelo de respaldo`,
      );
      hechas = total - pending.length;
      await lote(pending, 'vision_respaldo');
    }
    return out;
  }

  private async threadIdOf(messageId: string): Promise<string | null> {
    try {
      const m = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: { threadId: true },
      });
      return m?.threadId ?? null;
    } catch {
      return null;
    }
  }

  /** Sub-etapa para la vista de progreso; best-effort, solo etapa y contadores. */
  private async writeProgress(
    threadId: string | null | undefined,
    value: {
      etapa: 'ocr' | 'vision_enviando' | 'vision_procesando';
      regiones?: { total: number; hechas: number };
    },
  ): Promise<void> {
    if (!threadId) return;
    try {
      const key = `progress:${threadId}`;
      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    } catch {
      /* nunca rompe el OCR */
    }
  }
}
