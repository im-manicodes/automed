import { SynthesisService, stripFences } from './synthesis.service';

function setup(
  opts: { maxTokens?: string; body?: string; regions?: any[] } = {},
) {
  const syntheses: any[] = [];
  const prisma: any = {
    thread: {
      findUnique: jest.fn().mockResolvedValue({
        id: 't1',
        status: 'procesando',
        messages: [
          {
            from: 'ana@x.com',
            to: ['yo@x.com'],
            cc: [],
            subject: 'Asunto',
            bodyText: opts.body ?? 'Cuerpo del mensaje',
            isFromMe: false,
            receivedAt: new Date('2026-03-01T10:00:00Z'),
            attachments: [{ sha256: 'h1', filename: 'doc.pdf' }],
          },
          {
            from: 'yo@x.com',
            to: ['ana@x.com'],
            cc: [],
            subject: 'RE',
            bodyText: 'Mi respuesta',
            isFromMe: true,
            receivedAt: new Date('2026-03-02T10:00:00Z'),
            attachments: [],
          },
        ],
      }),
    },
    ocrPage: {
      findMany: jest.fn().mockResolvedValue([
        {
          sha256: 'h1',
          pageNumber: 1,
          text: null,
          regions: opts.regions ?? [
            { x: 0, y: 0, text: 'Línea', status: 'ok', userText: null },
            { x: 0, y: 1, text: '??', status: 'dudoso', userText: null },
          ],
        },
      ]),
    },
    synthesis: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          [...syntheses].sort((a, b) => b.version - a.version)[0] ?? null,
        ),
      ),
      findMany: jest.fn(),
      create: jest.fn(({ data }: any) => {
        syntheses.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  const templates: any = {
    getActive: jest.fn().mockResolvedValue({
      id: 'tpl1',
      version: 4,
      markdown: '## Resumen\n<!-- x -->',
    }),
  };
  const llm: any = {
    modelText: 'modelo-x',
    text: jest.fn().mockResolvedValue('## Resumen\nTodo bien'),
  };
  const config: any = {
    get: (k: string) =>
      k === 'SYNTH_MAX_INPUT_TOKENS' ? opts.maxTokens : undefined,
  };
  return {
    svc: new SynthesisService(prisma, templates, llm, config),
    prisma,
    llm,
    templates,
    syntheses,
  };
}

describe('SynthesisService', () => {
  it('arma el prompt con ilegibles, isFromMe y plantilla; guarda versión 1 con metadatos', async () => {
    const s = setup();
    const r = await s.svc.generate('t1');
    expect(r).toMatchObject({
      skipped: false,
      version: 1,
      status: 'necesita_revision',
      doubtfulCount: 1,
    });
    const [system, user] = s.llm.text.mock.calls[0];
    expect(system).toMatch(/NO inventes/);
    expect(user).toContain('## Resumen\n<!-- x -->');
    expect(user).toContain('[ilegible #1 · doc.pdf · p.1]');
    expect(user).toContain('ENVIADO POR MÍ');
    expect(s.syntheses[0]).toMatchObject({
      version: 1,
      model: 'modelo-x',
      templateId: 'tpl1',
      templateVersion: 4,
      markdown: '## Resumen\nTodo bien',
    });
  });

  it('usa texto_usuario y queda listo sin dudosas', async () => {
    const s = setup({
      regions: [
        { x: 0, y: 0, text: '??', status: 'corregido', userText: 'Total 100' },
      ],
    });
    const r = await s.svc.generate('t1');
    expect(r.status).toBe('listo');
    expect(s.llm.text.mock.calls[0][1]).toContain('Total 100');
  });

  it('no llama al LLM con el mismo hash; force sí; entrada distinta versiona', async () => {
    const s = setup();
    await s.svc.generate('t1');
    const again = await s.svc.generate('t1');
    expect(again).toMatchObject({ skipped: true, version: 1 });
    expect(s.llm.text).toHaveBeenCalledTimes(1);
    await s.svc.generate('t1', { force: true });
    expect(s.llm.text).toHaveBeenCalledTimes(2);
    expect(s.syntheses.map((x) => x.version)).toEqual([1, 2]);
    // una corrección cambia la entrada -> nueva versión
    s.prisma.ocrPage.findMany.mockResolvedValue([
      {
        sha256: 'h1',
        pageNumber: 1,
        text: null,
        regions: [
          {
            x: 0,
            y: 1,
            text: '??',
            status: 'corregido',
            userText: 'corregido',
          },
        ],
      },
    ]);
    const r3 = await s.svc.generate('t1');
    expect(r3).toMatchObject({ skipped: false, version: 3, status: 'listo' });
  });

  it('un cambio de plantilla regenera', async () => {
    const s = setup();
    await s.svc.generate('t1');
    s.templates.getActive.mockResolvedValue({
      id: 'tpl2',
      version: 5,
      markdown: '## Otra\n<!-- y -->',
    });
    expect((await s.svc.generate('t1')).skipped).toBe(false);
  });

  it('hilo largo: map por tramos y reduce, luego plantilla con notas', async () => {
    const s = setup({ maxTokens: '2000', body: 'palabra '.repeat(6000) });
    s.llm.text.mockImplementation((system: string) =>
      Promise.resolve(
        system.includes('condensa un fragmento')
          ? 'NOTAS'
          : system.includes('combina notas')
            ? 'COMBINADAS'
            : '## Resumen\nfinal',
      ),
    );
    await s.svc.generate('t1');
    const calls = s.llm.text.mock.calls;
    const maps = calls.filter((c: string[]) =>
      c[0].includes('condensa un fragmento'),
    );
    expect(maps.length).toBeGreaterThan(1);
    const last = calls[calls.length - 1];
    expect(last[0]).toMatch(/NO inventes/);
    expect(last[1]).toContain('NOTAS CONSOLIDADAS');
    expect(last[1]).toContain('NOTAS');
    expect(s.syntheses[0].markdown).toBe('## Resumen\nfinal');
  });

  it('stripFences quita el envoltorio de código', () => {
    expect(stripFences('```markdown\n## A\n```')).toBe('## A');
    expect(stripFences('## A')).toBe('## A');
  });
});
