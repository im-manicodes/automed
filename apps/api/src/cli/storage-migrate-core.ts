import {
  isFolderKey,
  nextPdfIndex,
  ownPageKey,
  pdfKey,
} from '../storage/storage-keys';

/** Puertos mínimos (Prisma y StorageService los cumplen; los tests usan fakes). */
export interface MigrateDb {
  attachment: {
    findMany(args: unknown): Promise<AttRow[]>;
    update(args: {
      where: { id: string };
      data: { storageKey: string };
    }): Promise<unknown>;
    count(args: { where: { storageKey: string } }): Promise<number>;
  };
  ocrPage: {
    findMany(args: { where: { sha256: string } }): Promise<
      {
        id: string;
        attachmentId: string;
        pageNumber: number;
        imageKey: string;
      }[]
    >;
    update(args: {
      where: { id: string };
      data: { imageKey: string };
    }): Promise<unknown>;
    count(args: { where: { imageKey: string } }): Promise<number>;
  };
}
export interface MigrateStorage {
  copy(src: string, dst: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}
export interface AttRow {
  id: string;
  sha256: string;
  storageKey: string;
  message: { threadId: string };
}

export interface MigrateOptions {
  apply: boolean;
  deleteOld: boolean;
  log?: (line: string) => void;
}
export interface MigrateSummary {
  pdfsMigrados: number;
  paginasCopiadas: number;
  referenciasActualizadas: number;
  objetosAntiguosBorrados: number;
  objetosAntiguosPendientes: number;
  omitidos: number;
  apply: boolean;
}

const isLegacy = (key: string) => !isFolderKey(key);

/**
 * Migra al layout hilos/<threadId>/pdf_<n>/ (idempotente). Sin `apply` solo muestra el plan.
 * Orden seguro: copiar -> actualizar BD -> (opcional) borrar lo antiguo sin referencias.
 * Solo registra ids y claves, nunca contenido.
 */
export async function migrateStorage(
  db: MigrateDb,
  storage: MigrateStorage,
  opts: MigrateOptions,
): Promise<MigrateSummary> {
  const log = opts.log ?? (() => undefined);
  const dry = !opts.apply;
  const sum: MigrateSummary = {
    pdfsMigrados: 0,
    paginasCopiadas: 0,
    referenciasActualizadas: 0,
    objetosAntiguosBorrados: 0,
    objetosAntiguosPendientes: 0,
    omitidos: 0,
    apply: opts.apply,
  };
  const attachments = await db.attachment.findMany({
    select: {
      id: true,
      sha256: true,
      storageKey: true,
      message: { select: { threadId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const keysByThread = new Map<string, string[]>();
  for (const a of attachments) {
    const list = keysByThread.get(a.message.threadId) ?? [];
    list.push(a.storageKey);
    keysByThread.set(a.message.threadId, list);
  }

  const oldKeys = new Set<string>();
  // 1) PDFs con clave antigua -> carpeta del hilo.
  const keyOf = new Map<string, string>(); // clave efectiva (tras migrar) por adjunto
  for (const a of attachments) keyOf.set(a.id, a.storageKey);
  for (const a of attachments) {
    const oldKey = a.storageKey;
    if (!isLegacy(oldKey)) continue;
    const threadId = a.message.threadId;
    const list = keysByThread.get(threadId)!;
    const dst = pdfKey(threadId, nextPdfIndex(list));
    if (!(await storage.exists(oldKey))) {
      log(`OMITIDO adjunto ${a.id}: no existe el objeto ${oldKey}`);
      sum.omitidos++;
      continue;
    }
    log(`PDF adjunto ${a.id}: ${oldKey} -> ${dst}`);
    if (!dry) {
      if (!(await storage.exists(dst))) await storage.copy(oldKey, dst);
      await db.attachment.update({
        where: { id: a.id },
        data: { storageKey: dst },
      });
      sum.referenciasActualizadas++;
    }
    oldKeys.add(oldKey);
    list.push(dst);
    sum.pdfsMigrados++;
    keyOf.set(a.id, dst);
  }

  // 2) Páginas: cada adjunto con carpeta propia recibe sus imágenes; el dueño del OCR las mueve.
  for (const a of attachments) {
    const key = keyOf.get(a.id)!;
    if (!isFolderKey(key)) continue;
    const pages = await db.ocrPage.findMany({ where: { sha256: a.sha256 } });
    for (const p of pages) {
      const dst = ownPageKey(key, p.pageNumber)!;
      const owner = p.attachmentId === a.id;
      if (p.imageKey === dst) continue;
      if (!(await storage.exists(p.imageKey))) {
        if (!(await storage.exists(dst))) {
          log(
            `OMITIDA página ${p.pageNumber} del adjunto ${a.id}: falta ${p.imageKey}`,
          );
          sum.omitidos++;
          continue;
        }
      }
      const present = await storage.exists(dst);
      if (!present) {
        log(`Página ${p.pageNumber} adjunto ${a.id}: ${p.imageKey} -> ${dst}`);
        if (!dry) await storage.copy(p.imageKey, dst);
        sum.paginasCopiadas++;
      }
      if (owner) {
        oldKeys.add(p.imageKey);
        if (!dry) {
          await db.ocrPage.update({
            where: { id: p.id },
            data: { imageKey: dst },
          });
          sum.referenciasActualizadas++;
        }
      }
    }
  }

  // 3) Borrado de lo antiguo: solo objetos del layout antiguo y sin ninguna referencia.
  for (const key of oldKeys) {
    if (!(key.startsWith('attachments/') || key.startsWith('pages/'))) continue;
    if (dry || !opts.deleteOld) {
      sum.objetosAntiguosPendientes++;
      continue;
    }
    const refs =
      (await db.attachment.count({ where: { storageKey: key } })) +
      (await db.ocrPage.count({ where: { imageKey: key } }));
    if (refs > 0) {
      log(`CONSERVADO ${key}: aún tiene ${refs} referencia(s)`);
      sum.objetosAntiguosPendientes++;
      continue;
    }
    await storage.delete(key);
    sum.objetosAntiguosBorrados++;
  }
  return sum;
}

export function parseStorageMigrateArgs(argv: string[]) {
  const out = { apply: false, deleteOld: false, help: false };
  for (const a of argv) {
    if (a === '--') continue;
    if (a === '--apply') out.apply = true;
    else if (a === '--dry-run') out.apply = false;
    else if (a === '--delete-old') out.deleteOld = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`Argumento no reconocido: ${a}`);
  }
  if (out.deleteOld && !out.apply) {
    throw new Error('--delete-old solo se usa junto con --apply');
  }
  return out;
}
