import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { SynthesisService } from './synthesis.service';
import { sanearParaWhatsApp } from './whatsapp-format';

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
    expect(user).toContain('adjunto sin leer');
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
    expect(system).toContain('adjunto sin leer');
  });

  it('preview whatsapp usa el formato propuesto y el correo de ejemplo', async () => {
    const s = setup([]);
    const r = await s.svc.preview('FORMATO_PROPUESTO', 'whatsapp');
    const [system, user] = s.llm.text.mock.calls[0];
    expect(system).toContain('NO inventes nada');
    expect(user).toContain('FORMATO_PROPUESTO');
    expect(user).toContain('Cotización de mantenimiento');
    expect(r.markdown).toBeTruthy();
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
  it('recorta a 1200 caracteres', () => {
    const t = sanearParaWhatsApp('palabra '.repeat(400));
    expect(t.length).toBeLessThanOrEqual(1202);
    expect(t.endsWith('…')).toBe(true);
  });
});
