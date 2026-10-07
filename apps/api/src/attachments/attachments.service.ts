import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ownPageKey } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';

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
      include: {
        regions: {
          where: { status: { in: ['dudoso', 'corregido'] } },
          orderBy: [{ y: 'asc' }, { x: 'asc' }],
        },
      },
    });
    return {
      attachmentId: att.id,
      filename: att.filename,
      status: att.status,
      pages: pages.map((p) => ({
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height,
        imageUrl: `/api/attachments/${att.id}/pages/${p.pageNumber}/image`,
        regions: p.regions.map((r) => ({
          id: r.id,
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          text: r.text,
          confidence: r.confidence,
          status: r.status,
          textoUsuario: r.userText,
        })),
      })),
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
