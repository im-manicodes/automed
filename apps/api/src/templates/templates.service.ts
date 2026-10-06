import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_TEMPLATE_KIND,
  isTemplateKind,
  TEMPLATE_KINDS,
  type TemplateKind,
} from './template-kinds';

export interface ActiveTemplate {
  id: string;
  name: string;
  kind: string;
  version: number;
  markdown: string;
  updatedAt: Date;
}

function assertKind(kind: unknown): TemplateKind {
  if (!isTemplateKind(kind))
    throw new BadRequestException('Tipo de plantilla no válido');
  return kind;
}

/**
 * Plantilla activa por tipo (`kind`): cada edición crea una versión nueva y desactiva la anterior
 * dentro de su tipo (historial). La versión es incremental por tipo.
 */
@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Devuelve la activa del tipo; si no existe aún, crea la versión 1 con la plantilla por defecto. */
  async getActive(
    kind: TemplateKind = DEFAULT_TEMPLATE_KIND,
  ): Promise<ActiveTemplate> {
    const k = assertKind(kind);
    const t = await this.prisma.template.findFirst({
      where: { kind: k, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (t) return t;
    const def = TEMPLATE_KINDS[k];
    return this.createVersion(k, def.defaultName, def.defaultMarkdown);
  }

  async updateActive(
    kind: TemplateKind,
    markdown: unknown,
    name?: unknown,
  ): Promise<ActiveTemplate> {
    const k = assertKind(kind);
    const err = TEMPLATE_KINDS[k].validate(markdown);
    if (err) throw new BadRequestException(err);
    const current = await this.getActive(k);
    const newName =
      typeof name === 'string' && name.trim()
        ? name.trim().slice(0, 100)
        : current.name;
    return this.createVersion(k, newName, (markdown as string).trim() + '\n');
  }

  /** Restaura la plantilla por defecto del tipo (versión nueva; el historial se conserva). */
  async reset(
    kind: TemplateKind = DEFAULT_TEMPLATE_KIND,
  ): Promise<ActiveTemplate> {
    const k = assertKind(kind);
    const def = TEMPLATE_KINDS[k];
    return this.createVersion(k, def.defaultName, def.defaultMarkdown);
  }

  private async createVersion(
    kind: TemplateKind,
    name: string,
    markdown: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.template.findFirst({
        where: { kind },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      await tx.template.updateMany({
        where: { kind, isActive: true },
        data: { isActive: false },
      });
      return tx.template.create({
        data: {
          kind,
          name,
          markdown,
          version: (last?.version ?? 0) + 1,
          isActive: true,
        },
      });
    });
  }
}
