import { AttachmentsService } from './attachments.service';

function setup(storageKey: string, imageKey: string, existing: string[]) {
  const prisma: any = {
    attachment: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'a1',
        sha256: 'sha',
        storageKey,
        filename: 'x.pdf',
        status: 'listo',
      }),
    },
    ocrPage: {
      findUnique: jest.fn().mockResolvedValue({ imageKey }),
      findMany: jest.fn().mockResolvedValue([
        {
          pageNumber: 1,
          width: 1,
          height: 1,
          imageKey,
          regions: [],
        },
      ]),
    },
  };
  const storage: any = {
    exists: jest.fn(async (k: string) => existing.includes(k)),
    get: jest.fn(async (k: string) => new Uint8Array([k.length])),
  };
  return { svc: new AttachmentsService(prisma, storage), storage };
}

describe('AttachmentsService (resolución de imágenes)', () => {
  const own = 'hilos/t2/pdf_1/pagina_1.png';
  const owner = 'hilos/t1/pdf_1/pagina_1.png';

  it('usa la copia en la carpeta del propio adjunto si existe', async () => {
    const { svc, storage } = setup('hilos/t2/pdf_1/original.pdf', owner, [own]);
    await svc.pageImage('a1', 1);
    expect(storage.get).toHaveBeenCalledWith(own);
    const r = await svc.listPages('a1');
    expect(r.pages[0].imageUrl).toBe('/api/attachments/a1/pages/1/image');
  });

  it('cae a OcrPage.imageKey si la copia no existe', async () => {
    const { svc, storage } = setup('hilos/t2/pdf_1/original.pdf', owner, []);
    await svc.pageImage('a1', 1);
    expect(storage.get).toHaveBeenCalledWith(owner);
  });

  it('claves antiguas (attachments/<sha>.pdf): usa imageKey sin consultar', async () => {
    const { svc, storage } = setup(
      'attachments/sha.pdf',
      'pages/sha/1.png',
      [],
    );
    await svc.pageImage('a1', 1);
    expect(storage.get).toHaveBeenCalledWith('pages/sha/1.png');
    expect(storage.exists).not.toHaveBeenCalled();
  });
});

describe('AttachmentsService.listPages (confianza)', () => {
  it('calcula confianza y nivel por página y por adjunto; solo devuelve dudosas/corregidas', async () => {
    const { svc } = setup('hilos/t2/pdf_1/original.pdf', 'k', []);
    (svc as any).prisma.ocrPage.findMany.mockResolvedValue([
      {
        pageNumber: 1,
        width: 1,
        height: 1,
        imageKey: 'k',
        engine: 'azure',
        regions: [
          {
            id: 'r1',
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            text: 'aaaa',
            confidence: 0.95,
            status: 'ok',
            userText: null,
          },
          {
            id: 'r2',
            x: 0,
            y: 1,
            w: 1,
            h: 1,
            text: 'bbbb',
            confidence: 0.55,
            status: 'dudoso',
            userText: null,
          },
        ],
      },
      {
        pageNumber: 2,
        width: 1,
        height: 1,
        imageKey: 'k2',
        engine: 'pdf-text',
        regions: [],
      },
    ]);
    const r = await svc.listPages('a1');
    expect(r.pages[0].confianza).toBeCloseTo(0.75);
    expect(r.pages[0].nivel).toBe('media');
    expect(r.pages[0].motor).toBe('azure');
    expect(r.pages[0].regions.map((g) => g.id)).toEqual(['r2']);
    expect(r.pages[1]).toMatchObject({ confianza: null, nivel: 'digital' });
    expect(r.confianza).toBeCloseTo(0.75);
    expect(r.nivel).toBe('media');
  });
});

describe('AttachmentsService.listPages (sugerencias)', () => {
  it('cada región incluye sugerencias: string[] (vacío si no hay)', async () => {
    const { svc } = setup('hilos/t1/pdf_1/original.pdf', 'k', []);
    const region = (id: string, sugerencias: unknown) => ({
      id,
      x: 0,
      y: 0,
      w: 0.1,
      h: 0.1,
      text: 't',
      confidence: 0.4,
      status: 'dudoso',
      userText: null,
      sugerencias,
    });
    (svc as any).prisma.ocrPage.findMany.mockResolvedValue([
      {
        pageNumber: 1,
        width: 1,
        height: 1,
        imageKey: 'k',
        engine: 'mock',
        regions: [
          region('r1', ['A', 'B']),
          region('r2', null),
          region('r3', ['', 5, 'C', 'D', 'E']),
        ],
      },
    ]);
    const r = await svc.listPages('a1');
    expect(r.pages[0].regions.map((x: any) => x.sugerencias)).toEqual([
      ['A', 'B'],
      [],
      ['C', 'D'],
    ]);
  });
});
