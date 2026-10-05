import { Injectable, NotFoundException } from '@nestjs/common';
import { PipelineService } from '../jobs/pipeline.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
  ) {}

  /** Guarda la corrección del usuario, marca 'corregido' y regenera la síntesis de los hilos. */
  async correctRegion(regionId: string, textoUsuario: string) {
    const region = await this.prisma.ocrRegion.findUnique({
      where: { id: regionId },
      include: { page: { select: { sha256: true } } },
    });
    if (!region) throw new NotFoundException('Región no encontrada');
    const updated = await this.prisma.ocrRegion.update({
      where: { id: regionId },
      data: { userText: textoUsuario, status: 'corregido', source: 'usuario' },
    });
    const threads = await this.pipeline.onRegionsChanged(region.page.sha256);
    return {
      id: updated.id,
      status: updated.status,
      textoUsuario: updated.userText,
      hilosReencolados: threads,
    };
  }
}
