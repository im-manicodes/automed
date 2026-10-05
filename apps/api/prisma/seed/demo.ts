import type { PrismaClient } from '../../src/generated/prisma/client';
import { buildDemoDataset } from './demo-data';
import { DEMO_PREFIX, DEMO_S3_PREFIX } from './demo-constants';
import { ensureActiveTemplate, type SeedEnv } from './base';

export type DemoDb = Pick<
  PrismaClient,
  | 'template'
  | 'mailAccount'
  | 'thread'
  | 'message'
  | 'attachment'
  | 'ocrPage'
  | 'ocrRegion'
  | 'synthesis'
  | 'user'
>;

/** Subconjunto de StorageService que usa el seed demo. */
export interface DemoStorage {
  isHealthy(): Promise<boolean>;
  put(
    key: string,
    body: Buffer | Uint8Array,
    contentType?: string,
  ): Promise<void>;
  deleteByPrefix(prefix: string): Promise<number>;
}

export interface DemoCounts {
  tickets: number;
  mensajes: number;
  pdfs: number;
  paginas: number;
  regiones: number;
  sintesis: number;
  imagenesSubidas: number;
}

export function assertNotProduction(env: SeedEnv, what: string) {
  if (env.NODE_ENV === 'production') {
    throw new Error(`${what} se niega a correr con NODE_ENV=production.`);
  }
}

/** Borra SOLO filas cuyo id empieza por `demo-` (y los objetos `demo/` en S3). */
export async function cleanDemo(
  db: DemoDb,
  storage: DemoStorage | null,
  log: (m: string) => void,
) {
  const where = { id: { startsWith: DEMO_PREFIX } };
  const counts = {
    regiones: (await db.ocrRegion.deleteMany({ where })).count,
    paginas: (await db.ocrPage.deleteMany({ where })).count,
    pdfs: (await db.attachment.deleteMany({ where })).count,
    sintesis: (await db.synthesis.deleteMany({ where })).count,
    mensajes: (await db.message.deleteMany({ where })).count,
    tickets: (await db.thread.deleteMany({ where })).count,
    cuentas: (await db.mailAccount.deleteMany({ where })).count,
    plantillas: (await db.template.deleteMany({ where })).count,
  };
  log(
    `Demo borrado en BD: ${counts.tickets} tickets, ${counts.mensajes} mensajes, ${counts.pdfs} PDF, ${counts.paginas} páginas, ${counts.regiones} regiones, ${counts.sintesis} síntesis, ${counts.cuentas} cuenta, ${counts.plantillas} plantilla.`,
  );
  let objetos = 0;
  if (!storage) {
    log(
      'AVISO: sin almacenamiento configurado; no se borraron objetos S3 demo.',
    );
  } else if (!(await storage.isHealthy())) {
    log(
      'AVISO: RustFS/S3 no disponible; no se borraron los objetos demo/ (reintenta cuando esté arriba).',
    );
  } else {
    objetos = await storage.deleteByPrefix(DEMO_S3_PREFIX);
    log(`Demo borrado en S3: ${objetos} objetos bajo "${DEMO_S3_PREFIX}".`);
  }
  return { ...counts, objetosS3: objetos };
}

/** Recrea el juego de datos demo (primero limpia lo demo, así es re-ejecutable). */
export async function seedDemo(
  db: DemoDb,
  storage: DemoStorage | null,
  env: SeedEnv,
  log: (m: string) => void,
  render: (
    page: ReturnType<typeof buildDemoDataset>['pages'][number],
  ) => Buffer,
  now: Date = new Date(),
): Promise<DemoCounts> {
  assertNotProduction(env, 'db:seed:demo');
  await cleanDemo(db, null, () => undefined);
  await ensureActiveTemplate(db);

  const ds = buildDemoDataset(now);
  await db.template.create({ data: ds.template as never });
  await db.mailAccount.create({ data: ds.account as never });
  for (const r of ds.threads) await db.thread.create({ data: r as never });
  for (const r of ds.messages) await db.message.create({ data: r as never });
  for (const r of ds.attachments)
    await db.attachment.create({ data: r as never });
  for (const p of ds.pages) {
    await db.ocrPage.create({
      data: {
        id: p.id,
        attachmentId: p.attachmentId,
        sha256: `${DEMO_PREFIX}sha-${p.id}`,
        pageNumber: p.pageNumber,
        imageKey: p.imageKey,
        width: p.width,
        height: p.height,
        text: p.lines.map((l) => l.text).join('\n'),
        engine: 'demo',
      },
    });
  }
  for (const r of ds.regions) await db.ocrRegion.create({ data: r as never });
  for (const r of ds.syntheses) await db.synthesis.create({ data: r as never });

  let imagenesSubidas = 0;
  if (!storage) {
    log(
      'AVISO: sin almacenamiento configurado; se omiten las imágenes de página (el visor de corrección no mostrará la hoja).',
    );
  } else if (!(await storage.isHealthy())) {
    log(
      'AVISO: RustFS/S3 no disponible; se omiten SOLO las imágenes de página (el resto del demo se creó). Vuelve a correr db:seed:demo con RustFS arriba.',
    );
  } else {
    for (const p of ds.pages) {
      await storage.put(p.imageKey, render(p), 'image/png');
      imagenesSubidas++;
    }
  }

  const counts: DemoCounts = {
    tickets: ds.threads.length,
    mensajes: ds.messages.length,
    pdfs: ds.attachments.length,
    paginas: ds.pages.length,
    regiones: ds.regions.length,
    sintesis: ds.syntheses.length,
    imagenesSubidas,
  };
  log(
    `Demo creado: ${counts.tickets} tickets, ${counts.mensajes} mensajes, ${counts.pdfs} PDF, ${counts.paginas} páginas, ${counts.regiones} regiones, ${counts.sintesis} síntesis, ${counts.imagenesSubidas} imágenes subidas.`,
  );
  log(
    'Recuerda: son datos FICTICIOS (ids "demo-", asuntos "[DEMO]"), sin tokens de Microsoft; el sync no los toca.',
  );
  return counts;
}
