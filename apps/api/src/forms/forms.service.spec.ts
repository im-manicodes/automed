import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FormsService, catalogHash } from './forms.service';
import { CATALOGS, aiFields } from './catalogs';

// pdfjs-dist (ESM) no carga bajo Jest sin --experimental-vm-modules; el rasterizado real se
// prueba en form-preview.spec.ts (`pnpm test:preview`).
jest.mock('./form-preview', () => ({
  renderFormPreview: jest.fn().mockResolvedValue([Buffer.from('png-1')]),
}));

const SECRET = 'MARIA-LOPEZ-SECRETA';

function setup(
  opts: {
    status?: string;
    llm?: (p: string) => string | Error;
    synId?: string;
  } = {},
) {
  const store = new Map<string, any>();
  const synId = { current: opts.synId ?? 's1' };
  const prisma: any = {
    thread: {
      findUnique: ({ where }: any) =>
        Promise.resolve(
          where.id === 't1'
            ? { id: 't1', status: opts.status ?? 'listo' }
            : null,
        ),
    },
    synthesis: {
      findMany: () =>
        Promise.resolve([{ id: synId.current, markdown: `Resumen ${SECRET}` }]),
    },
    formDraft: {
      findUnique: ({ where }: any) => {
        const w = where.threadId_formato;
        return Promise.resolve(store.get(`${w.threadId}|${w.formato}`) ?? null);
      },
      upsert: ({ where, create, update }: any) => {
        const w = where.threadId_formato;
        const key = `${w.threadId}|${w.formato}`;
        const row = store.has(key)
          ? { ...store.get(key), ...update, updatedAt: new Date() }
          : { ...create, updatedAt: new Date() };
        store.set(key, row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: any) => {
        const w = where.threadId_formato;
        const key = `${w.threadId}|${w.formato}`;
        const row = { ...store.get(key), ...data, updatedAt: new Date() };
        store.set(key, row);
        return Promise.resolve(row);
      },
    },
  };
  const calls: { system: string; user: string; opts: any }[] = [];
  const llm: any = {
    text: jest.fn((system: string, user: string, o: any) => {
      calls.push({ system, user, opts: o });
      const r = (opts.llm ?? (() => '{}'))(user);
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    }),
    modelFor: jest.fn().mockResolvedValue('modelo-x'),
  };
  return { svc: new FormsService(prisma, llm), llm, calls, store, synId };
}

const cat = CATALOGS[0];
const campos = aiFields(cat);
const texto = campos.find((c) => c.tipo === 'texto')!;
const casilla = campos.find((c) => c.tipo === 'casilla');

describe('FormsService', () => {
  it('listFormats expone los catálogos sin datos internos del PDF', () => {
    const f = new FormsService({} as any, {} as any).listFormats();
    expect(f.map((x) => x.id)).toEqual(CATALOGS.map((c) => c.id));
    expect(JSON.stringify(f)).not.toContain('pdfCampos');
    expect(f[0].campos[0]).toHaveProperty('soloManual');
  });

  it('draft válido: usa la tarea evento, solo la síntesis y devuelve faltantes', async () => {
    const { svc, calls } = setup({
      llm: () =>
        '```json\n' + JSON.stringify({ [texto.clave]: 'Hola' }) + '\n```',
    });
    const r = await svc.draft('t1', cat.id);
    expect(r.formato).toBe(cat.id);
    expect(r.valores[texto.clave]).toBe('Hola');
    expect(r.errores).toEqual([]);
    expect(r.faltantes).not.toContain(texto.clave);
    expect(r.faltantes.length).toBe(campos.length - 1);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts).toMatchObject({ task: 'evento', threadId: 't1' });
    expect(calls[0].user).toContain(SECRET);
  });

  it('descarta claves extra y soloManual, y reporta valores inválidos', async () => {
    const manual = cat.campos.find((c) => c.soloManual);
    const { svc } = setup({
      llm: () =>
        JSON.stringify({
          inventada: 'x',
          ...(manual ? { [manual.clave]: 'firma' } : {}),
          ...(casilla ? { [casilla.clave]: 'no-boolean' } : {}),
        }),
    });
    const r = await svc.draft('t1', cat.id);
    expect(r.valores).not.toHaveProperty('inventada');
    if (manual) expect(r.valores).not.toHaveProperty(manual.clave);
    if (casilla) expect(r.errores.length).toBe(1);
  });

  it('JSON inválido o error del LLM -> 503', async () => {
    await expect(
      setup({ llm: () => 'no es json' }).svc.draft('t1', cat.id),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      setup({ llm: () => new Error('boom') }).svc.draft('t1', cat.id),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('hilo no listo -> 409 sin llamar al LLM; inexistente -> 404; formato -> 400', async () => {
    for (const status of ['sin_analizar', 'procesando', 'necesita_revision']) {
      const { svc, llm } = setup({ status });
      await expect(svc.draft('t1', cat.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(llm.text).not.toHaveBeenCalled();
    }
    await expect(setup().svc.draft('zz', cat.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(setup().svc.draft('t1', 'otro')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('render: PDF válido, nombre sin datos del paciente; 400 con valores inválidos', async () => {
    const { svc } = setup();
    const r = await svc.render('t1', cat.id, { [texto.clave]: 'Hola' });
    expect(Buffer.from(r.bytes).subarray(0, 4).toString()).toBe('%PDF');
    expect(r.filename).toMatch(
      new RegExp(`^${cat.id}-\\d{4}-\\d{2}-\\d{2}\\.pdf$`),
    );
    await expect(
      svc.render('t1', cat.id, { [texto.clave]: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.render('zz', cat.id, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.render('t1', cat.id, null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('preview: data URLs PNG; 400 con valores inválidos; 404 hilo inexistente', async () => {
    const { svc, llm } = setup();
    const r = await svc.preview('t1', cat.id, { [texto.clave]: 'Hola ñandú' });
    expect(r.paginas).toHaveLength(1);
    for (const u of r.paginas) expect(u).toMatch(/^data:image\/png;base64,/);
    expect(llm.text).not.toHaveBeenCalled();
    await expect(
      svc.preview('t1', cat.id, { [texto.clave]: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.preview('zz', cat.id, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.preview('t1', 'otro', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  }, 30000);

  describe('borrador guardado', () => {
    const t2 = campos.filter((c) => c.tipo === 'texto')[1] ?? texto;
    const ia = (o: Record<string, unknown>) => () => JSON.stringify(o);

    it('primera propuesta guarda; segunda apertura NO llama al LLM', async () => {
      const { svc, llm, store } = setup({ llm: ia({ [texto.clave]: 'Hola' }) });
      const r1 = await svc.draft('t1', cat.id);
      expect(r1).toMatchObject({ guardado: true, desactualizado: false });
      expect(r1.camposEditados).toEqual([]);
      expect(store.size).toBe(1);
      expect([...store.values()][0]).toMatchObject({
        synthesisId: 's1',
        modelo: 'modelo-x',
        catalogHash: catalogHash(cat),
      });
      const r2 = await svc.draft('t1', cat.id);
      expect(r2.valores[texto.clave]).toBe('Hola');
      expect(llm.text).toHaveBeenCalledTimes(1);
      const g = await svc.getSaved('t1', cat.id);
      expect(g).toMatchObject({ existe: true, desactualizado: false });
      expect(llm.text).toHaveBeenCalledTimes(1);
    });

    it('getSaved sin borrador -> existe:false; 404 con hilo inexistente', async () => {
      const { svc } = setup();
      expect((await svc.getSaved('t1', cat.id)).existe).toBe(false);
      await expect(svc.getSaved('zz', cat.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('actualizar conserva campos editados y reemplaza los no editados', async () => {
      let n = 0;
      const { svc, llm, store } = setup({
        llm: () =>
          JSON.stringify(
            n++ === 0
              ? { [texto.clave]: 'A1', [t2.clave]: 'B1' }
              : { [texto.clave]: 'A2', [t2.clave]: 'B2' },
          ),
      });
      await svc.draft('t1', cat.id);
      await svc.saveEdits('t1', cat.id, {
        [texto.clave]: 'EDITADO',
        [t2.clave]: 'B1',
      });
      const r = await svc.draft('t1', cat.id, { actualizar: true });
      expect(llm.text).toHaveBeenCalledTimes(2);
      expect(r.valores[texto.clave]).toBe('EDITADO');
      if (t2.clave !== texto.clave) expect(r.valores[t2.clave]).toBe('B2');
      expect(r.camposEditados).toEqual([texto.clave]);
      expect([...store.values()][0].valoresIA[texto.clave]).toBe('A2');
    });

    it('desactualizado=true tras una síntesis nueva', async () => {
      const { svc, synId } = setup({ llm: ia({ [texto.clave]: 'Hola' }) });
      await svc.draft('t1', cat.id);
      synId.current = 's2';
      expect((await svc.getSaved('t1', cat.id)).desactualizado).toBe(true);
      expect((await svc.draft('t1', cat.id)).desactualizado).toBe(true);
      const r = await svc.draft('t1', cat.id, { actualizar: true });
      expect(r.desactualizado).toBe(false);
      expect((await svc.getSaved('t1', cat.id)).desactualizado).toBe(false);
    });

    it('saveEdits: 404 sin borrador, 400 con valores inválidos, guarda lo válido', async () => {
      const { svc, store } = setup({ llm: ia({ [texto.clave]: 'Hola' }) });
      await expect(
        svc.saveEdits('t1', cat.id, { [texto.clave]: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await svc.draft('t1', cat.id);
      await expect(
        svc.saveEdits('t1', cat.id, { [texto.clave]: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.saveEdits('t1', cat.id, null)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      const r = await svc.saveEdits('t1', cat.id, {
        [texto.clave]: 'Nuevo',
        inventada: 'x',
      });
      expect(r.valores).toEqual({ [texto.clave]: 'Nuevo' });
      expect(r.camposEditados).toEqual([texto.clave]);
      expect([...store.values()][0].valores).toEqual({
        [texto.clave]: 'Nuevo',
      });
    });

    it('catalogHash distinto descarta claves desconocidas sin llamar al LLM', async () => {
      const { svc, llm, store } = setup({ llm: ia({ [texto.clave]: 'Hola' }) });
      await svc.draft('t1', cat.id);
      const row = [...store.values()][0];
      row.catalogHash = 'viejo';
      row.valores = { ...row.valores, clave_vieja: 'x' };
      row.valoresIA = { ...row.valoresIA, clave_vieja: 'x' };
      const r = await svc.draft('t1', cat.id);
      expect(r.valores).not.toHaveProperty('clave_vieja');
      expect(r.valores[texto.clave]).toBe('Hola');
      expect(r.faltantes.length).toBe(campos.length - 1);
      expect((await svc.getSaved('t1', cat.id)).valores).not.toHaveProperty(
        'clave_vieja',
      );
      expect(llm.text).toHaveBeenCalledTimes(1);
    });

    it('el prompt prefiere Constantes e Historial de eventos', async () => {
      const { svc, calls } = setup();
      await svc.draft('t1', cat.id);
      expect(calls[0].system).toContain('## Constantes');
      expect(calls[0].system).toContain('## Historial de eventos');
    });
  });
});
