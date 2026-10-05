import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_TEMPLATE_MARKDOWN,
  validateTemplateMarkdown,
} from './default-template';
import { TemplatesService } from './templates.service';

/** Prisma en memoria mínimo para Template. */
function fakePrisma() {
  const rows: any[] = [];
  const api = {
    rows,
    template: {
      findFirst: jest.fn(({ where, orderBy }: any) => {
        let r = rows.filter(
          (x) =>
            !where ||
            where.isActive === undefined ||
            x.isActive === where.isActive,
        );
        if (orderBy) r = [...r].sort((a, b) => b.version - a.version);
        return Promise.resolve(r[0] ?? null);
      }),
      updateMany: jest.fn(({ data }: any) => {
        rows.filter((r) => r.isActive).forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: 1 });
      }),
      create: jest.fn(({ data }: any) => {
        const row = {
          id: `t${rows.length + 1}`,
          updatedAt: new Date(),
          ...data,
        };
        rows.push(row);
        return Promise.resolve(row);
      }),
    },
    $transaction: (fn: any) => fn(api),
  };
  return api;
}

describe('TemplatesService', () => {
  it('crea la plantilla por defecto en español la primera vez', async () => {
    const s = new TemplatesService(fakePrisma() as never);
    const t = await s.getActive();
    expect(t.version).toBe(1);
    expect(t.markdown).toBe(DEFAULT_TEMPLATE_MARKDOWN);
    for (const sec of [
      'Asunto',
      'Participantes',
      'Resumen ejecutivo',
      'Línea de tiempo',
      'Decisiones',
      'Acciones pendientes',
      'Fechas y montos relevantes',
      'Contenido de adjuntos',
      'Dudas por aclarar',
    ])
      expect(t.markdown).toContain(`# ${sec}`);
  });

  it('editar crea versión nueva activa y conserva historial; reset vuelve al default', async () => {
    const db = fakePrisma();
    const s = new TemplatesService(db as never);
    await s.getActive();
    const v2 = await s.updateActive('## Solo resumen\n<!-- breve -->');
    expect(v2.version).toBe(2);
    expect(db.rows.filter((r) => r.isActive)).toHaveLength(1);
    expect((await s.getActive()).version).toBe(2);
    const v3 = await s.reset();
    expect(v3.version).toBe(3);
    expect(v3.markdown).toBe(DEFAULT_TEMPLATE_MARKDOWN);
    expect(db.rows).toHaveLength(3);
  });

  it('valida tamaño y forma', async () => {
    expect(validateTemplateMarkdown('corto')).toBeTruthy();
    expect(validateTemplateMarkdown('x'.repeat(30))).toBeTruthy();
    expect(
      validateTemplateMarkdown('## Sección\n' + 'x'.repeat(30000)),
    ).toBeTruthy();
    expect(validateTemplateMarkdown('## Sección ok con contenido')).toBeNull();
    const s = new TemplatesService(fakePrisma() as never);
    await expect(s.updateActive(123)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
