import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_TEMPLATE_MARKDOWN,
  validateTemplateMarkdown,
} from './default-template';
import { TemplatesService } from './templates.service';
import {
  DEFAULT_WHATSAPP_TEMPLATE_MARKDOWN,
  TEMPLATE_KINDS,
  validateWhatsappTemplate,
} from './template-kinds';
import { parseReportColumns } from './report-columns';

/** Prisma en memoria mínimo para Template. */
function fakePrisma() {
  const rows: any[] = [];
  const api = {
    rows,
    template: {
      findFirst: jest.fn(({ where, orderBy }: any) => {
        let r = rows.filter(
          (x) =>
            (where?.kind === undefined || x.kind === where.kind) &&
            (where?.isActive === undefined || x.isActive === where.isActive),
        );
        if (orderBy) r = [...r].sort((a, b) => b.version - a.version);
        return Promise.resolve(r[0] ?? null);
      }),
      updateMany: jest.fn(({ where, data }: any) => {
        rows
          .filter(
            (r) =>
              r.isActive &&
              (where?.kind === undefined || r.kind === where.kind),
          )
          .forEach((r) => Object.assign(r, data));
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
      'Paciente',
      'Ingreso y diagnóstico',
      'Plan de manejo vigente',
      'Evolución por día',
      'Pendientes y en espera',
      'Contenido de adjuntos',
      'Dudas por aclarar',
    ])
      expect(t.markdown).toContain(`# ${sec}`);
  });

  it('editar crea versión nueva activa y conserva historial; reset vuelve al default', async () => {
    const db = fakePrisma();
    const s = new TemplatesService(db as never);
    await s.getActive();
    const v2 = await s.updateActive(
      'resumen',
      '## Solo resumen\n<!-- breve -->',
    );
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
    await expect(s.updateActive('resumen', 123)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('versiones y activa son independientes por tipo', async () => {
    const db = fakePrisma();
    const s = new TemplatesService(db as never);
    const r1 = await s.getActive('resumen');
    const w1 = await s.getActive('whatsapp');
    expect(r1.version).toBe(1);
    expect(w1.version).toBe(1);
    expect(w1.kind).toBe('whatsapp');
    expect(w1.markdown).toBe(DEFAULT_WHATSAPP_TEMPLATE_MARKDOWN);
    const w2 = await s.updateActive(
      'whatsapp',
      'Mensaje corto con *negrita* y viñetas',
    );
    expect(w2.version).toBe(2);
    // el resumen no cambió ni se desactivó
    expect((await s.getActive('resumen')).id).toBe(r1.id);
    expect(
      db.rows.filter((r) => r.kind === 'resumen' && r.isActive),
    ).toHaveLength(1);
    expect(
      db.rows.filter((r) => r.kind === 'whatsapp' && r.isActive),
    ).toHaveLength(1);
    // reset solo del tipo indicado
    const w3 = await s.reset('whatsapp');
    expect(w3.version).toBe(3);
    expect(w3.markdown).toBe(DEFAULT_WHATSAPP_TEMPLATE_MARKDOWN);
    expect((await s.getActive('resumen')).version).toBe(1);
  });

  it('valida por tipo: whatsapp no exige encabezados # y tiene tope propio', async () => {
    expect(
      validateWhatsappTemplate('Texto libre sin encabezados ok'),
    ).toBeNull();
    expect(validateWhatsappTemplate('corto')).toBeTruthy();
    expect(validateWhatsappTemplate('x'.repeat(3001))).toBeTruthy();
    const s = new TemplatesService(fakePrisma() as never);
    await expect(
      s.updateActive('resumen', 'Texto libre sin encabezados ok'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      s.updateActive('whatsapp', 'Texto libre sin encabezados ok'),
    ).resolves.toMatchObject({ kind: 'whatsapp' });
  });

  it('kind inválido -> BadRequestException', async () => {
    const s = new TemplatesService(fakePrisma() as never);
    await expect(s.getActive('otro' as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(s.reset('otro' as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('los defaults de resumen, whatsapp y reporte validan', () => {
    for (const kind of ['resumen', 'whatsapp', 'reporte'] as const) {
      const def = TEMPLATE_KINDS[kind];
      expect(def.validate(def.defaultMarkdown)).toBeNull();
      expect(def.defaultMarkdown.length).toBeLessThanOrEqual(def.maxChars);
    }
    expect(DEFAULT_TEMPLATE_MARKDOWN).toContain('## Dudas por aclarar');
    expect(DEFAULT_TEMPLATE_MARKDOWN).toContain('## Contenido de adjuntos');
    expect(
      parseReportColumns(TEMPLATE_KINDS.reporte.defaultMarkdown).columnas,
    ).toHaveLength(21);
  });
});
