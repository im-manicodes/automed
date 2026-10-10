import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { SynthesisService } from './synthesis.service';
import { sanearParaWhatsApp, WHATSAPP_MAX_CHARS } from './whatsapp-format';
import {
  DEFAULT_WHATSAPP_TEMPLATE_MARKDOWN,
  validateWhatsappTemplate,
} from '../templates/template-kinds';

function setup(messages: any[], pages: any[] = []) {
  const prisma: any = {
    thread: { findUnique: jest.fn().mockResolvedValue({ id: 't1', messages }) },
    ocrPage: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          pages.filter((p) => where.sha256.in.includes(p.sha256)),
        ),
      ),
    },
    synthesis: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  };
  const templates: any = {
    getActive: jest.fn((kind: string) =>
      Promise.resolve({
        id: 'tp',
        version: 1,
        markdown:
          kind === 'whatsapp' ? 'FORMATO_WA_XYZ' : '## PLANTILLA_RESUMEN_XYZ',
      }),
    ),
  };
  const llm: any = {
    modelFor: jest.fn().mockResolvedValue('m'),
    text: jest.fn().mockResolvedValue('## Hola\n- **Pide** pago'),
  };
  const aiSettings: any = {
    getEffective: jest.fn().mockResolvedValue({ maxInputTokens: 60000 }),
  };
  return {
    svc: new SynthesisService(prisma, templates, llm, aiSettings),
    templates,
    prisma,
    llm,
  };
}
const msg = (id: string, day: number, body: string, atts: any[] = []) => ({
  id,
  from: 'ana@x.com',
  to: ['yo@x.com'],
  cc: [],
  subject: 'Asunto',
  bodyText: body,
  isFromMe: false,
  receivedAt: new Date(`2026-03-0${day}T10:00:00Z`),
  attachments: atts,
});

describe('SynthesisService.whatsappLast', () => {
  it('omite las zonas dudosas y los adjuntos sin texto, sin marcas ni avisos', async () => {
    const s = setup(
      [msg('m1', 1, 'CUERPO', [{ sha256: 'h1', filename: 'nota.pdf' }])],
      [
        {
          sha256: 'h1',
          pageNumber: 1,
          text: null,
          regions: [
            {
              x: 0.1,
              y: 0.1,
              w: 0.2,
              h: 0.02,
              text: 'TA 120/80',
              status: 'ok',
              userText: null,
            },
            {
              x: 0.1,
              y: 0.3,
              w: 0.2,
              h: 0.02,
              text: 'ras?o',
              status: 'dudoso',
              userText: null,
            },
            {
              x: 0.1,
              y: 0.5,
              w: 0.2,
              h: 0.02,
              text: 'mal',
              status: 'dudoso',
              userText: 'FC 80',
            },
          ],
        },
        { sha256: 'h1', pageNumber: 2, text: '', regions: [] },
      ],
    );
    await s.svc.whatsappLast('t1');
    const [, user] = s.llm.text.mock.calls[0];
    expect(user).toContain('TA 120/80');
    expect(user).toContain('FC 80');
    expect(user).not.toContain('ras?o');
    expect(user).not.toMatch(/ilegible|sin leer|sin texto/);
    expect(user).not.toContain('página 2');
  });

  it('el prompt lleva solo el último correo y el OCR de sus adjuntos', async () => {
    const s = setup(
      [
        msg('m1', 1, 'CUERPO VIEJO', [{ sha256: 'h1', filename: 'viejo.pdf' }]),
        msg('m2', 2, 'CUERPO NUEVO', [
          { sha256: 'h2', filename: 'nuevo.pdf' },
          { sha256: 'h3', filename: 'pendiente.pdf' },
        ]),
      ],
      [
        { sha256: 'h1', pageNumber: 1, text: 'OCR VIEJO', regions: [] },
        { sha256: 'h2', pageNumber: 1, text: 'OCR NUEVO', regions: [] },
      ],
    );
    const r = await s.svc.whatsappLast('t1');
    const [, user] = s.llm.text.mock.calls[0];
    expect(user).toContain('CUERPO NUEVO');
    expect(user).toContain('OCR NUEVO');
    expect(user).not.toContain('adjunto sin leer');
    expect(user).not.toContain('CUERPO VIEJO');
    expect(user).not.toContain('OCR VIEJO');
    expect(r.texto).toBe('*Hola*\n• *Pide* pago');
    expect(s.prisma.synthesis.create).not.toHaveBeenCalled();
    expect(s.prisma.synthesis.findMany).not.toHaveBeenCalled();
  });

  it('usa la plantilla whatsapp como formato y no la del resumen', async () => {
    const s = setup([msg('m1', 1, 'HOLA')]);
    await s.svc.whatsappLast('t1');
    expect(s.templates.getActive).toHaveBeenCalledWith('whatsapp');
    expect(s.templates.getActive).not.toHaveBeenCalledWith('resumen');
    const [system, user] = s.llm.text.mock.calls[0];
    expect(user).toContain('FORMATO_WA_XYZ');
    expect(user).not.toContain('PLANTILLA_RESUMEN_XYZ');
    // las reglas de seguridad no editables siguen en el system prompt
    expect(system).toContain('NO inventes nada');
    expect(system).toContain('PROHIBIDO describir los documentos');
    expect(system).not.toContain('_Falta: ...');
    expect(system).not.toContain('adjunto sin leer');
    expect(s.llm.text.mock.calls[0][2]).toMatchObject({ maxTokens: 2000 });
  });

  it('preview whatsapp usa el formato propuesto y el correo de ejemplo', async () => {
    const s = setup([]);
    const r = await s.svc.preview('FORMATO_PROPUESTO', 'whatsapp');
    const [system, user] = s.llm.text.mock.calls[0];
    expect(system).toContain('NO inventes nada');
    expect(user).toContain('FORMATO_PROPUESTO');
    expect(user).toContain('Cotización de mantenimiento');
    expect(r.markdown).toBeTruthy();
    expect(s.llm.text.mock.calls[0][2]).toMatchObject({ maxTokens: 2000 });
    expect(s.templates.getActive).not.toHaveBeenCalled();
  });

  it('409 sin correos', async () => {
    const s = setup([]);
    await expect(s.svc.whatsappLast('t1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(s.llm.text).not.toHaveBeenCalled();
  });

  it('error del LLM -> 503 con mensaje seguro', async () => {
    const s = setup([msg('m1', 1, 'SECRETO')]);
    s.llm.text.mockRejectedValue(new Error('SECRETO boom'));
    const e: any = await s.svc.whatsappLast('t1').catch((x) => x);
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect(e.message).not.toContain('SECRETO');
  });
});

describe('sanearParaWhatsApp', () => {
  it('convierte encabezados, negritas, viñetas y tablas', () => {
    expect(
      sanearParaWhatsApp(
        '# Título\n**a** y [b](http://x)\n* uno\n| A | B |\n|---|---|\n| 1 | 2 |',
      ),
    ).toBe('*Título*\n*a* y b (http://x)\n• uno\n• A | B\n• 1 | 2');
  });
  it('conserva `código` en línea sin tocar su contenido', () => {
    expect(sanearParaWhatsApp('TA `120/70` y `a**b**c` __ok__')).toBe(
      'TA `120/70` y `a**b**c` _ok_',
    );
  });
  it('conserva bloques ``` tal cual', () => {
    const t = sanearParaWhatsApp('Datos:\n```\n# no titulo\n- x\n```\nFin');
    expect(t).toBe('Datos:\n```\n# no titulo\n- x\n```\nFin');
  });
  it('el límite por defecto es 3500 y corta en párrafo, no a media línea', () => {
    expect(WHATSAPP_MAX_CHARS).toBe(3500);
    const parr = 'linea completa de prueba. '.repeat(10).trim();
    const t = sanearParaWhatsApp(Array(30).fill(parr).join('\n\n'));
    expect(t.length).toBeLessThanOrEqual(WHATSAPP_MAX_CHARS + 2);
    expect(t.endsWith('\n…')).toBe(true);
    for (const l of t.replace(/\n…$/, '').split('\n').filter(Boolean))
      expect(l).toBe(parr);
  });
  it('no deja un bloque ``` abierto al cortar', () => {
    const t = sanearParaWhatsApp(
      'intro\n\n```\n' + 'x\n'.repeat(100) + '```',
      60,
    );
    expect((t.match(/```/g) ?? []).length % 2).toBe(0);
  });
  it('un texto corto no se recorta', () => {
    expect(sanearParaWhatsApp('palabra '.repeat(300))).not.toContain('…');
  });
});

describe('DEFAULT_WHATSAPP_TEMPLATE_MARKDOWN', () => {
  it('no contiene valores de ejemplo reales y valida', () => {
    for (const bad of [
      '312',
      'apendicectom',
      '120/70',
      '117',
      '11.2',
      'Hab. 3',
    ])
      expect(DEFAULT_WHATSAPP_TEMPLATE_MARKDOWN.toLowerCase()).not.toContain(
        bad.toLowerCase(),
      );
    expect(
      validateWhatsappTemplate(DEFAULT_WHATSAPP_TEMPLATE_MARKDOWN),
    ).toBeNull();
    expect(DEFAULT_WHATSAPP_TEMPLATE_MARKDOWN).toContain('{');
    // ninguna cifra fuera de marcadores {…}, comentarios y fechas dd/mm
    const sinMarcas = DEFAULT_WHATSAPP_TEMPLATE_MARKDOWN.replace(
      /<!--[\s\S]*?-->/g,
      '',
    ).replace(/\{[^}]*\}/g, '');
    expect(sinMarcas.replace(/SatO2/g, '')).not.toMatch(/\d/);
  });
});
