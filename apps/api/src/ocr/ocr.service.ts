import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { pageKey } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import { CancelledError } from '../jobs/cancelled.error';
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
import type { ZonaLeida } from './vision-retry.service';

/** Valor de OcrPage.engine para páginas digitales (texto del PDF -> markdown, sin OCR). */
export const PDF_TEXT_ENGINE = 'pdf-text';

export type StoredRegion = ClassifiedRegion & {
  source: 'ocr' | 'vision';
  /** Hasta 2 lecturas posibles de una zona que sigue dudosa (se guardan en OcrRegion.sugerencias). */
  sugerencias?: string[];
};

/** Punto de control de cancelación: false -> se lanza CancelledError. */
export type ShouldContinue = () => Promise<boolean>;

async function checkpoint(shouldContinue?: ShouldContinue): Promise<void> {
  if (shouldContinue && !(await shouldContinue())) throw new CancelledError();
}

/** Progreso escrito en `progress:<threadId>` (solo etapa, contadores y modelo). */
type ProgressValue = {
  etapa: 'ocr' | 'vision_enviando' | 'vision_procesando';
  regiones?: { total: number; hechas: number };
  /** Modelo que lee las zonas dudosas (solo en las etapas de visión). */
  modelo?: string;
};

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

  /**
   * `shouldContinue` se comprueba al inicio de cada página y de cada lote de visión; si devuelve
   * false lanza CancelledError. Nada se persiste en BD hasta la transacción final (no quedan
   * OcrPage a medias; las PNG ya subidas se sobrescriben en el siguiente análisis).
   */
  async process(
    attachmentId: string,
    opts: { shouldContinue?: ShouldContinue } = {},
  ): Promise<void> {
    const { shouldContinue } = opts;
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
      await checkpoint(shouldContinue);
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
      const result = await this.engine.recognize(page.png, page.pageNumber, {
        threadId,
      });
      const lines = regionsOf(result);
      let regions: StoredRegion[] = classifyRegions(
        lines,
        this.cfg.confidenceThreshold,
      ).map((r) => ({ ...r, source: 'ocr' as const }));
      regions = await this.readDoubtfulZones(
        page.png,
        regions,
        threadId,
        shouldContinue,
      );
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
                  ...(r.sugerencias && r.sugerencias.length > 0
                    ? { sugerencias: r.sugerencias }
                    : {}),
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
   * UNA sola pasada de visión (si está habilitada): las zonas `dudoso` (hasta `getMaxRegions()`
   * por página) van en lotes de `VISION_BATCH_SIZE` recortes al modelo de `vision`, que devuelve
   * por zona lectura + confianza + alternativas. Lectura válida con confianza >= umbral -> `ok`
   * (`source:'vision'`); si no, sigue `dudoso` con hasta 2 sugerencias para la revisión. Un lote
   * fallido deja sus zonas dudosas sin sugerencias. Las regiones `ok` nunca se envían. La
   * cancelación se comprueba antes de cada lote.
   */
  async readDoubtfulZones(
    png: Uint8Array,
    regions: StoredRegion[],
    threadId?: string | null,
    shouldContinue?: ShouldContinue,
  ): Promise<StoredRegion[]> {
    if (!(await this.vision.isEnabled())) return regions;
    const budget = Math.max(await this.vision.getMaxRegions(), 0);
    const idx: number[] = [];
    regions.forEach((r, i) => {
      if (r.status === 'dudoso' && idx.length < budget) idx.push(i);
    });
    const total = idx.length;
    if (total === 0) return regions;

    const modelo = await this.modelOf();
    await this.writeProgress(threadId, {
      etapa: 'vision_enviando',
      regiones: { total, hechas: 0 },
      ...(modelo ? { modelo } : {}),
    });
    const out = [...regions];
    const threshold = this.vision.acceptThreshold;
    let hechas = 0;
    let resueltas = 0;
    let fallidas = 0;
    for (let k = 0; k < idx.length; k += VISION_BATCH_SIZE) {
      await checkpoint(shouldContinue);
      const chunk = idx.slice(k, k + VISION_BATCH_SIZE);
      await this.writeProgress(threadId, {
        etapa: 'vision_procesando',
        regiones: { total, hechas },
        ...(modelo ? { modelo } : {}),
      });
      let zonas: ZonaLeida[] = [];
      try {
        zonas = await this.vision.readZones(
          png,
          chunk.map((i) => ({ box: regions[i].box, ocrText: regions[i].text })),
          threadId,
        );
      } catch {
        fallidas += chunk.length;
        this.logger.warn(
          `Falló la lectura con visión en lote (${chunk.length} zonas)`,
        );
      }
      chunk.forEach((i, j) => {
        const z = zonas[j];
        if (!z) return;
        if (z.lectura && z.lectura.confidence >= threshold) {
          out[i] = {
            ...regions[i],
            text: z.lectura.text,
            confidence: z.lectura.confidence,
            status: 'ok',
            source: 'vision',
          };
          resueltas++;
        } else if (z.sugerencias.length > 0) {
          out[i] = { ...regions[i], sugerencias: z.sugerencias };
        }
      });
      hechas += chunk.length;
    }
    const conSugerencias = idx.filter(
      (i) => (out[i].sugerencias?.length ?? 0) > 0,
    ).length;
    this.logger.log(
      `Visión: ${resueltas} de ${total} zonas resueltas, ${conSugerencias} con sugerencias${fallidas ? ` (${fallidas} en lotes fallidos)` : ''}`,
    );
    return out;
  }

  /** Nombre del modelo de `vision` para la vista de progreso; undefined si no se puede leer. */
  private async modelOf(): Promise<string | undefined> {
    try {
      const m = await this.vision.modelFor('vision');
      return typeof m === 'string' && m.trim() !== '' ? m : undefined;
    } catch {
      return undefined;
    }
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
    value: ProgressValue,
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
