import {
  migrateStorage,
  parseStorageMigrateArgs,
  type MigrateDb,
} from './storage-migrate-core';

function setup() {
  const atts: any[] = [
    {
      id: 'a1',
      sha256: 'S',
      storageKey: 'attachments/S.pdf',
      message: { threadId: 't1' },
    },
    // gemelo en otro hilo que reutilizaba la misma clave antigua
    {
      id: 'a2',
      sha256: 'S',
      storageKey: 'attachments/S.pdf',
      message: { threadId: 't2' },
    },
    {
      id: 'a3',
      sha256: 'T',
      storageKey: 'hilos/t1/pdf_3/original.pdf',
      message: { threadId: 't1' },
    },
  ];
  const pages: any[] = [
    {
      id: 'p1',
      attachmentId: 'a1',
      sha256: 'S',
      pageNumber: 1,
      imageKey: 'pages/S/1.png',
    },
    {
      id: 'p2',
      attachmentId: 'a1',
      sha256: 'S',
      pageNumber: 2,
      imageKey: 'pages/S/2.png',
    },
  ];
  const objects = new Set<string>([
    'attachments/S.pdf',
    'pages/S/1.png',
    'pages/S/2.png',
    'hilos/t1/pdf_3/original.pdf',
  ]);
  const db: MigrateDb = {
    attachment: {
      findMany: async () => atts,
      update: async ({ where, data }) => {
        Object.assign(
          atts.find((a) => a.id === where.id),
          data,
        );
      },
      count: async ({ where }) =>
        atts.filter((a) => a.storageKey === where.storageKey).length,
    },
    ocrPage: {
      findMany: async ({ where }) =>
        pages.filter((p) => p.sha256 === where.sha256),
      update: async ({ where, data }) => {
        Object.assign(
          pages.find((p) => p.id === where.id),
          data,
        );
      },
      count: async ({ where }) =>
        pages.filter((p) => p.imageKey === where.imageKey).length,
    },
  };
  const storage = {
    copy: jest.fn(async (_s: string, d: string) => void objects.add(d)),
    exists: jest.fn(async (k: string) => objects.has(k)),
    delete: jest.fn(async (k: string) => void objects.delete(k)),
  };
  return { atts, pages, objects, db, storage };
}

describe('storage-migrate', () => {
  it('por defecto (dry-run) no cambia nada', async () => {
    const s = setup();
    const r = await migrateStorage(s.db, s.storage, {
      apply: false,
      deleteOld: false,
    });
    expect(r.pdfsMigrados).toBe(2);
    expect(s.storage.copy).not.toHaveBeenCalled();
    expect(s.atts[0].storageKey).toBe('attachments/S.pdf');
    expect(s.pages[0].imageKey).toBe('pages/S/1.png');
  });

  it('--apply migra PDFs (índice libre por hilo), páginas y gemelos; es idempotente', async () => {
    const s = setup();
    await migrateStorage(s.db, s.storage, { apply: true, deleteOld: false });
    expect(s.atts[0].storageKey).toBe('hilos/t1/pdf_4/original.pdf'); // t1 ya tenía pdf_3
    expect(s.atts[1].storageKey).toBe('hilos/t2/pdf_1/original.pdf');
    expect(s.pages.map((p) => p.imageKey)).toEqual([
      'hilos/t1/pdf_4/pagina_1.png',
      'hilos/t1/pdf_4/pagina_2.png',
    ]);
    // el gemelo (otro hilo) tiene su propia copia de las páginas
    expect(s.objects.has('hilos/t2/pdf_1/pagina_1.png')).toBe(true);
    expect(s.objects.has('hilos/t2/pdf_1/original.pdf')).toBe(true);
    // los objetos antiguos siguen ahí sin --delete-old
    expect(s.objects.has('attachments/S.pdf')).toBe(true);

    s.storage.copy.mockClear();
    const again = await migrateStorage(s.db, s.storage, {
      apply: true,
      deleteOld: false,
    });
    expect(again.pdfsMigrados).toBe(0);
    expect(again.paginasCopiadas).toBe(0);
    expect(s.storage.copy).not.toHaveBeenCalled();
  });

  it('--delete-old borra solo objetos antiguos sin referencias', async () => {
    const s = setup();
    // una referencia colgante impide borrar pages/S/2.png
    s.pages.push({
      id: 'p9',
      attachmentId: 'zz',
      sha256: 'Z',
      pageNumber: 1,
      imageKey: 'pages/S/2.png',
    });
    await migrateStorage(s.db, s.storage, { apply: true, deleteOld: true });
    expect(s.objects.has('attachments/S.pdf')).toBe(false);
    expect(s.objects.has('pages/S/1.png')).toBe(false);
    expect(s.objects.has('pages/S/2.png')).toBe(true);
    expect(s.objects.has('hilos/t1/pdf_4/original.pdf')).toBe(true);
  });

  it('omite (sin tocar la BD) si falta el objeto antiguo', async () => {
    const s = setup();
    s.objects.delete('attachments/S.pdf');
    const r = await migrateStorage(s.db, s.storage, {
      apply: true,
      deleteOld: false,
    });
    expect(r.omitidos).toBeGreaterThan(0);
    expect(s.atts[0].storageKey).toBe('attachments/S.pdf');
  });

  it('argumentos: --delete-old exige --apply', () => {
    expect(parseStorageMigrateArgs([])).toMatchObject({ apply: false });
    expect(() => parseStorageMigrateArgs(['--delete-old'])).toThrow();
    expect(parseStorageMigrateArgs(['--apply', '--delete-old'])).toMatchObject({
      apply: true,
      deleteOld: true,
    });
  });
});
