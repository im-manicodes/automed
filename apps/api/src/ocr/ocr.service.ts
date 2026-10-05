import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { AttachmentProcessor } from '../jobs/pipeline-hooks.interface';
import { classifyRegions, regionsOf } from './ocr-classifier';
import type { ClassifiedRegion } from './ocr-classifier';
import { OcrConfig, readOcrConfig } from './ocr-config';
import { OCR_ENGINE } from './ocr-engine.interface';
import type { OcrEngine } from './ocr-engine.interface';
import { PdfRasterizerService } from './pdf-rasterizer.service';
import { VisionRetryService } from './vision-retry.service';

export const pageImageKey = (sha256: string, pageNumber: number) =>
  `pages/${sha256}/${pageNumber}.png`;

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
    const rasters = await this.rasterizer.rasterize(pdf);

    const built: {
      pageNumber: number;
      width: number;
      height: number;
      text: string;
      regions: StoredRegion[];
    }[] = [];
    for (const page of rasters) {
      await this.storage.put(
        pageImageKey(att.sha256, page.pageNumber),
        page.png,
        'image/png',
      );
      const result = await this.engine.recognize(page.png, page.pageNumber);
      const lines = regionsOf(result);
      let regions: StoredRegion[] = classifyRegions(
        lines,
        this.cfg.confidenceThreshold,
      ).map((r) => ({ ...r, source: 'ocr' as const }));
      regions = await this.retryWithVision(page.png, regions);
      built.push({
        pageNumber: page.pageNumber,
        width: page.width,
        height: page.height,
        text: lines.map((l) => l.text).join('\n'),
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
              imageKey: pageImageKey(att.sha256, p.pageNumber),
              width: p.width,
              height: p.height,
              text: p.text,
              engine: this.engine.name,
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
      `OCR listo: adjunto ${att.id}, ${built.length} páginas, motor ${this.engine.name}`,
    );
  }

  /** Relee con visión las regiones dudosas (si está habilitado); alta confianza -> ok. */
  async retryWithVision(
    png: Uint8Array,
    regions: StoredRegion[],
  ): Promise<StoredRegion[]> {
    if (!this.vision.enabled) return regions;
    let budget = this.vision.maxRegions;
    const out: StoredRegion[] = [];
    for (const r of regions) {
      if (r.status !== 'dudoso' || budget <= 0) {
        out.push(r);
        continue;
      }
      budget--;
      try {
        const reading = await this.vision.reread(png, r.box, r.text);
        if (reading && reading.confidence >= this.vision.acceptThreshold) {
          out.push({
            ...r,
            text: reading.text,
            confidence: reading.confidence,
            status: 'ok',
            source: 'vision',
          });
          continue;
        }
      } catch {
        this.logger.warn('Falló la relectura con visión de una región');
      }
      out.push(r);
    }
    return out;
  }
}
