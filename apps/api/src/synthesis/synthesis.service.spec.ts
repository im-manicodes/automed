import { LlmTruncatedError } from '../llm/llm-provider.interface';
import { SynthesisService, stripFences } from './synthesis.service';

interface SetupOpts {
  maxTokens?: string;
  body?: string;
  regions?: any[];
}

function setup(opts: SetupOpts = {}) {
  const syntheses: any[] = [];
  const messages: any[] = [
    {
      id: 'm1',
      from: 'ana@x.com',
      to: ['yo@x.com'],
      cc: [],
      subject: 'Asunto',
      bodyText: opts.body ?? 'Cuerpo del mensaje ANTIGUO',
      isFromMe: false,
      receivedAt: new Date('2026-03-01T10:00:00Z'),
      attachments: [{ sha256: 'h1', filename: 'doc.pdf' }],
    },
    {
      id: 'm2',
      from: 'yo@x.com',
      to: ['ana@x.com'],
      cc: [],
      subject: 'RE',
      bodyText: 'Mi respuesta ANTIGUA',
      isFromMe: true,
      receivedAt: new Date('2026-03-02T10:00:00Z'),
      attachments: [],
    },
  ];
  const pagesDb: any[] = [
    {
      sha256: 'h1',
      pageNumber: 1,
      text: null,
      regions: opts.regions ?? [
        { x: 0, y: 0, text: 'Línea OCR ANTIGUA', status: 'ok', userText: null },
        { x: 0, y: 1, text: '??', status: 'dudoso', userText: null },
      ],
    },
  ];
  const prisma: any = {
    thread: {
      findUnique: jest.fn(() =>
        Promise.resolve({ id: 't1', status: 'procesando', messages }),
      ),
    },
    ocrPage: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          pagesDb.filter((p) => where.sha256.in.includes(p.sha256)),
        ),
      ),
    },
    template: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id === 'tpl1'
            ? { id: 'tpl1', version: 4, markdown: '## Resumen\n<!-- x -->' }
            : null,
        ),
      ),
    },
    synthesis: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          [...syntheses].sort((a, b) => b.version - a.version)[0] ?? null,
        ),
      ),
      findMany: jest.fn(() =>
        Promise.resolve([...syntheses].sort((a, b) => b.version - a.version)),
      ),
      create: jest.fn(({ data }: any) => {
        const row = {
          id: `s${syntheses.length + 1}`,
          createdAt: new Date(),
          ...data,
        };
        syntheses.push(row);
        return Promise.resolve(row);
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
    modelFor: jest.fn().mockResolvedValue('modelo-x'),
    text: jest.fn().mockResolvedValue('## Resumen\nTodo bien'),
  };
  const aiSettings: any = {
    getEffective: jest
      .fn()
      .mockResolvedValue({ maxInputTokens: Number(opts.maxTokens ?? 60000) }),
  };
  const addMessage = (id: string, body: string, sha?: string) =>
    messages.push({
      id,
      from: 'ana@x.com',
      to: ['yo@x.com'],
      cc: [],
      subject: 'Nuevo',
      bodyText: body,
      isFromMe: false,
      receivedAt: new Date(`2026-03-0${messages.length + 1}T10:00:00Z`),
      attachments: sha ? [{ sha256: sha, filename: `${sha}.pdf` }] : [],
    });
  const addPage = (sha: string, text: string) =>
    pagesDb.push({
      sha256: sha,
      pageNumber: 1,
      text: null,
      regions: [{ x: 0, y: 0, text, status: 'ok', userText: null }],
    });
  return {
    svc: new SynthesisService(prisma, templates, llm, aiSettings),
    prisma,
    llm,
    templates,
    syntheses,
    messages,
    pagesDb,
    addMessage,
    addPage,
  };
}

describe('SynthesisService', () => {
  it('pide failOnTruncate y, si la salida se corta, falla con mensaje claro sin guardar Synthesis', async () => {
    const s = setup();
    s.llm.text.mockRejectedValue(new LlmTruncatedError());
    await expect(s.svc.generate('t1')).rejects.toThrow(
      /salió más largo de lo que permite el modelo/,
    );
    expect(s.llm.text.mock.calls[0][2]).toMatchObject({
      failOnTruncate: true,
      task: 'resumen',
    });
    expect(s.prisma.synthesis.create).not.toHaveBeenCalled();
    expect(s.syntheses).toHaveLength(0);
  });

  it('sin síntesis previa: modo completo con ilegibles, isFromMe y plantilla; guarda cobertura', async () => {
    const s = setup();
    const r = await s.svc.generate('t1');
    expect(r).toMatchObject({
      skipped: false,
      version: 1,
      status: 'necesita_revision',
      doubtfulCount: 1,
      mode: 'full',
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
      mode: 'full',
      baseSynthesisId: null,
      coveredMessageIds: ['m1', 'm2'],
    });
    expect(s.syntheses[0].inputTokensEstimados).toBeGreaterThan(0);
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

  it('no llama al LLM si no hay nada nuevo; force (completo) sí', async () => {
    const s = setup();
    await s.svc.generate('t1');
    const again = await s.svc.generate('t1');
    expect(again).toMatchObject({ skipped: true, version: 1 });
    expect(s.llm.text).toHaveBeenCalledTimes(1);
    const forced = await s.svc.generate('t1', { force: true });
    expect(forced).toMatchObject({ skipped: false, version: 2, mode: 'full' });
    expect(s.llm.text).toHaveBeenCalledTimes(2);
    expect(s.syntheses[1].baseSynthesisId).toBeNull();
    // el regenerate envía el hilo completo (mensajes antiguos incluidos)
    expect(s.llm.text.mock.calls[1][1]).toContain('Cuerpo del mensaje ANTIGUO');
  });

  it('incremental: solo síntesis previa + mensajes nuevos + OCR de adjuntos nuevos; nada antiguo', async () => {
    const s = setup();
    s.llm.text.mockResolvedValueOnce('## Resumen\nSÍNTESIS PREVIA');
    await s.svc.generate('t1');
    s.addMessage('m3', 'Mensaje NUEVO con factura', 'h2');
    s.addPage('h2', 'OCR NUEVO factura 500');
    const r = await s.svc.generate('t1');
    expect(r).toMatchObject({
      skipped: false,
      version: 2,
      mode: 'incremental',
    });
    const [system, user] = s.llm.text.mock.calls[1];
    expect(system).toMatch(/ACTUALIZA/);
    expect(user).toContain('## Resumen\n<!-- x -->'); // plantilla
    expect(user).toContain('SÍNTESIS PREVIA');
    expect(user).toContain('Mensaje NUEVO con factura');
    expect(user).toContain('OCR NUEVO factura 500');
    expect(user).not.toContain('ANTIGUO');
    expect(user).not.toContain('ANTIGUA');
    expect(user).not.toContain('doc.pdf');
    expect(s.syntheses[1]).toMatchObject({
      mode: 'incremental',
      baseSynthesisId: 's1',
      coveredMessageIds: ['m1', 'm2', 'm3'],
      templateVersion: 4,
    });
  });

  it('reanalyzeMessageId: incremental con síntesis previa + solo ese correo y su OCR (no el hilo completo)', async () => {
    const s = setup();
    s.llm.text.mockResolvedValueOnce('## Resumen\nSÍNTESIS PREVIA');
    s.addMessage('m3', 'Último correo con factura', 'h2');
    s.addPage('h2', 'OCR ULTIMO factura 900');
    await s.svc.generate('t1');
    s.llm.text.mockResolvedValueOnce('## Resumen\nSÍNTESIS CORREGIDA');
    const r = await s.svc.generate('t1', { reanalyzeMessageId: 'm3' });
    expect(r).toMatchObject({
      skipped: false,
      version: 2,
      mode: 'incremental',
    });
    const [system, user] = s.llm.text.mock.calls[1];
    expect(system).toMatch(/ACTUALIZA/);
    expect(user).toContain('SÍNTESIS PREVIA');
    expect(user).toContain('Último correo con factura');
    expect(user).toContain('OCR ULTIMO factura 900');
    expect(user).not.toContain('ANTIGUO');
    expect(user).not.toContain('ANTIGUA');
    expect(s.syntheses[1]).toMatchObject({
      mode: 'incremental',
      baseSynthesisId: 's1',
      coveredMessageIds: ['m1', 'm2', 'm3'],
    });
    expect(s.syntheses[1].inputTokensEstimados).toBeGreaterThan(0);
  });

  it('reanalyzeMessageId sin síntesis previa: modo completo', async () => {
    const s = setup();
    const r = await s.svc.generate('t1', { reanalyzeMessageId: 'm2' });
    expect(r.mode).toBe('full');
  });

  it('un adjunto nuevo idéntico a uno ya procesado no reenvía su contenido', async () => {
    const s = setup();
    await s.svc.generate('t1');
    s.addMessage('m3', 'Reenvío del mismo PDF', 'h1');
    await s.svc.generate('t1');
    const user = s.llm.text.mock.calls[1][1];
    expect(user).toContain('Mismo contenido que');
    expect(user).not.toContain('Línea OCR ANTIGUA');
  });

  it('cobertura: cada versión cubre todos los mensajes y "nuevos" son los no cubiertos', async () => {
    const s = setup();
    await s.svc.generate('t1');
    s.addMessage('m3', 'tres');
    await s.svc.generate('t1');
    s.addMessage('m4', 'cuatro');
    await s.svc.generate('t1');
    expect(s.syntheses.map((x) => x.coveredMessageIds)).toEqual([
      ['m1', 'm2'],
      ['m1', 'm2', 'm3'],
      ['m1', 'm2', 'm3', 'm4'],
    ]);
    const last = s.llm.text.mock.calls[2][1];
    expect(last).toContain('cuatro');
    expect(last).not.toContain('tres');
    // sin novedades: no hay llamada
    const calls = s.llm.text.mock.calls.length;
    expect((await s.svc.generate('t1')).skipped).toBe(true);
    expect(s.llm.text.mock.calls.length).toBe(calls);
  });

  it('el tamaño estimado de entrada del incremental es menor que el del completo', async () => {
    const s = setup({ body: 'palabra '.repeat(2000) });
    await s.svc.generate('t1'); // full
    s.addMessage('m3', 'una novedad corta');
    await s.svc.generate('t1'); // incremental
    const full = s.syntheses[0].inputTokensEstimados;
    const inc = s.syntheses[1].inputTokensEstimados;
    expect(inc).toBeLessThan(full);
    const forced = await s.svc.generate('t1', { force: true });
    expect(forced.inputTokensEstimados).toBeGreaterThan(inc);
  });

  it('cambio de plantilla: NO regenera solo; sigue incremental con la plantilla anterior y avisa', async () => {
    const s = setup();
    await s.svc.generate('t1');
    s.templates.getActive.mockResolvedValue({
      id: 'tpl2',
      version: 5,
      markdown: '## Otra\n<!-- y -->',
    });
    // sin novedades: no se llama al LLM
    expect((await s.svc.generate('t1')).skipped).toBe(true);
    expect(s.llm.text).toHaveBeenCalledTimes(1);
    // el aviso queda expuesto
    s.prisma.synthesis.findMany.mockResolvedValue([...s.syntheses]);
    s.prisma.thread.findUnique.mockResolvedValueOnce({
      id: 't1',
      status: 'listo',
    });
    const got = await s.svc.getForThread('t1');
    expect(got.plantillaDesactualizada).toBe(true);
    expect(got.plantillaActivaVersion).toBe(5);
    expect(got.latest?.templateVersion).toBe(4);
    // llega un mensaje: incremental con la plantilla vieja (formato del markdown previo)
    s.addMessage('m3', 'nuevo');
    const r = await s.svc.generate('t1');
    expect(r.mode).toBe('incremental');
    const user = s.llm.text.mock.calls[1][1];
    expect(user).toContain('## Resumen\n<!-- x -->');
    expect(user).not.toContain('## Otra');
    expect(s.syntheses[1].templateVersion).toBe(4);
    // regenerate explícito: completo con la plantilla nueva
    await s.svc.generate('t1', { force: true });
    expect(s.llm.text.mock.calls[2][1]).toContain('## Otra');
    expect(s.syntheses[2]).toMatchObject({ mode: 'full', templateVersion: 5 });
  });

  it('sin plantilla desactualizada el flag es false', async () => {
    const s = setup();
    await s.svc.generate('t1');
    s.prisma.thread.findUnique.mockResolvedValueOnce({
      id: 't1',
      status: 'listo',
    });
    const got = await s.svc.getForThread('t1');
    expect(got.plantillaDesactualizada).toBe(false);
    expect(got.latest).toMatchObject({ mode: 'full', mensajesCubiertos: 2 });
  });

  it('síntesis previa sin cobertura (anterior a la migración) o vacía: modo completo', async () => {
    const s = setup();
    s.syntheses.push({
      id: 'old',
      version: 1,
      markdown: '## Viejo',
      inputHash: 'x',
      coveredMessageIds: [],
      mode: 'full',
      templateId: 'tpl1',
      templateVersion: 4,
    });
    const r = await s.svc.generate('t1');
    expect(r).toMatchObject({ mode: 'full', version: 2, skipped: false });
    expect(s.llm.text.mock.calls[0][1]).toContain('Cuerpo del mensaje ANTIGUO');
  });

  it('corrección de región: solo el documento afectado con la corrección, sin el resto del hilo', async () => {
    const s = setup();
    s.addMessage('m3', 'Otro mensaje', 'h2');
    s.addPage('h2', 'OCR de otro documento');
    await s.svc.generate('t1');
    // el usuario corrige la región dudosa de h1
    s.pagesDb[0].regions[1] = {
      x: 0,
      y: 1,
      text: '??',
      status: 'corregido',
      userText: 'Total 777',
    };
    const r = await s.svc.generate('t1', { correctedSha256: 'h1' });
    expect(r).toMatchObject({
      mode: 'incremental',
      version: 2,
      status: 'listo',
    });
    const [system, user] = s.llm.text.mock.calls[1];
    expect(system).toMatch(/ACTUALIZA/);
    expect(user).toContain('Total 777');
    expect(user).toContain('Línea OCR ANTIGUA');
    expect(user).toContain('DOCUMENTO CORREGIDO');
    expect(user).toContain('SOLO lo que dependa de él');
    expect(user).not.toContain('Cuerpo del mensaje ANTIGUO');
    expect(user).not.toContain('Mi respuesta ANTIGUA');
    expect(user).not.toContain('OCR de otro documento');
    expect(s.syntheses[1].coveredMessageIds).toEqual(['m1', 'm2', 'm3']);
  });

  it('presupuesto: síntesis previa + novedades sobre el límite resume las novedades por tramos', async () => {
    const s = setup({ maxTokens: '2000' });
    await s.svc.generate('t1');
    s.addMessage('m3', 'palabra '.repeat(6000));
    s.llm.text.mockImplementation((system: string) =>
      Promise.resolve(
        system.includes('condensa un fragmento')
          ? 'NOTAS'
          : system.includes('combina notas')
            ? 'COMBINADAS'
            : '## Resumen\nfinal',
      ),
    );
    const r = await s.svc.generate('t1');
    expect(r.mode).toBe('incremental');
    const calls = s.llm.text.mock.calls.slice(1);
    expect(
      calls.filter((c: string[]) => c[0].includes('condensa un fragmento'))
        .length,
    ).toBeGreaterThan(1);
    const last = calls[calls.length - 1];
    expect(last[0]).toMatch(/ACTUALIZA/);
    expect(last[1]).toContain('resumen por tramos');
    expect(last[1]).not.toContain('palabra palabra');
  });

  it('hilo largo (completo): map por tramos y reduce, luego plantilla con notas', async () => {
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

  it('preview del tipo reporte devuelve las columnas parseadas sin llamar al LLM', async () => {
    const { svc, llm } = setup();
    const r = await svc.preview(
      '- Paciente: Nombre\n- Hospital: Dónde',
      'reporte',
    );
    expect(r).toMatchObject({
      columnas: [
        { nombre: 'Paciente', instruccion: 'Nombre' },
        { nombre: 'Hospital', instruccion: 'Dónde' },
      ],
      error: null,
    });
    const bad = await svc.preview('sin viñetas', 'reporte');
    expect(bad).toMatchObject({ columnas: [] });
    expect((bad as { error: string }).error).toContain('al menos una');
    expect(llm.text).not.toHaveBeenCalled();
  });
});
