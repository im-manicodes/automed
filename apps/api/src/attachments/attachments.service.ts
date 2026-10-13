import { Injectable, NotFoundException } from '@nestjs/common';
import { confidenceLevel, pageConfidence } from '../ocr/ocr-confidence';
import { PrismaService } from '../prisma/prisma.service';
import { ownPageKey } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';

/** `OcrRegion.sugerencias` (Json) -> arreglo de textos; vacío si no hay o no es válido. */
export function sugerenciasOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .slice(0, 2);
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Páginas OCR de un adjunto. Los resultados se buscan por sha256 (PDFs repetidos comparten). */
  async listPages(attachmentId: string) {
    const att = await this.findAttachment(attachmentId);
    const pages = await this.prisma.ocrPage.findMany({
      where: { sha256: att.sha256 },
      orderBy: { pageNumber: 'asc' },
      include: { regions: { orderBy: [{ y: 'asc' }, { x: 'asc' }] } },
    });
    const all = pages.flatMap((p) => p.regions);
    const total = pageConfidence(all);
    return {
      attachmentId: att.id,
      filename: att.filename,
      status: att.status,
      confianza: total,
      nivel: confidenceLevel(total),
      pages: pages.map((p) => {
        const confianza = pageConfidence(p.regions);
        return {
          pageNumber: p.pageNumber,
          width: p.width,
          height: p.height,
          imageUrl: `/api/attachments/${att.id}/pages/${p.pageNumber}/image`,
          motor: p.engine,
          confianza,
          nivel: confidenceLevel(confianza),
          regions: p.regions
            .filter((r) => r.status === 'dudoso' || r.status === 'corregido')
            .map((r) => ({
              id: r.id,
              x: r.x,
              y: r.y,
              w: r.w,
              h: r.h,
              text: r.text,
              confidence: r.confidence,
              status: r.status,
              textoUsuario: r.userText,
              sugerencias: sugerenciasOf(r.sugerencias),
            })),
        };
      }),
    };
  }

  /** Bytes PNG de la página (para el visor, sin exponer URLs de RustFS). */
  async pageImage(attachmentId: string, pageNumber: number) {
    const att = await this.findAttachment(attachmentId);
    const page = await this.prisma.ocrPage.findUnique({
      where: { sha256_pageNumber: { sha256: att.sha256, pageNumber } },
      select: { imageKey: true },
    });
    if (!page) throw new NotFoundException('Página no encontrada');
    return this.storage.get(
      await this.resolveImageKey(att.storageKey, pageNumber, page.imageKey),
    );
  }

  /**
   * Imagen de la página: primero la copia en la carpeta del propio adjunto; si no existe (datos
   * antiguos o copia fallida) cae a OcrPage.imageKey (la del dueño del OCR).
   */
  private async resolveImageKey(
    storageKey: string,
    pageNumber: number,
    imageKey: string,
  ) {
    const own = ownPageKey(storageKey, pageNumber);
    if (!own || own === imageKey) return imageKey;
    return (await this.storage.exists(own)) ? own : imageKey;
  }

  private async findAttachment(id: string) {
    const att = await this.prisma.attachment.findUnique({ where: { id } });
    if (!att) throw new NotFoundException('Adjunto no encontrado');
    return att;
  }
}
