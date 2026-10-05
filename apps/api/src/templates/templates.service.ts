import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_TEMPLATE_MARKDOWN,
  DEFAULT_TEMPLATE_NAME,
  validateTemplateMarkdown,
} from './default-template';

export interface ActiveTemplate {
  id: string;
  name: string;
  version: number;
  markdown: string;
  updatedAt: Date;
}

/** Plantilla activa: cada edición crea una versión nueva y desactiva la anterior (historial). */
@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Devuelve la activa; si no existe aún, crea la versión 1 con la plantilla por defecto. */
  async getActive(): Promise<ActiveTemplate> {
    const t = await this.prisma.template.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    if (t) return t;
    return this.createVersion(DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_MARKDOWN);
  }

  async updateActive(
    markdown: unknown,
    name?: unknown,
  ): Promise<ActiveTemplate> {
    const err = validateTemplateMarkdown(markdown);
    if (err) throw new BadRequestException(err);
    const current = await this.getActive();
    const newName =
      typeof name === 'string' && name.trim()
        ? name.trim().slice(0, 100)
        : current.name;
    return this.createVersion(newName, (markdown as string).trim() + '\n');
  }

  /** Restaura la plantilla por defecto (como una versión nueva; el historial se conserva). */
  async reset(): Promise<ActiveTemplate> {
    return this.createVersion(DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_MARKDOWN);
  }

  private async createVersion(name: string, markdown: string) {
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.template.findFirst({
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      await tx.template.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      return tx.template.create({
        data: {
          name,
          markdown,
          version: (last?.version ?? 0) + 1,
          isActive: true,
        },
      });
    });
  }
}
