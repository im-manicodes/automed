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
    presignedGetUrl: jest.fn(async (k: string) => `url:${k}`),
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
    expect(r.pages[0].imageUrl).toBe(`url:${own}`);
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
