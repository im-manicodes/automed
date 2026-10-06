/**
 * Migra lo ya guardado en RustFS al layout por hilo: hilos/<threadId>/pdf_<n>/original.pdf y pagina_<k>.png.
 *   pnpm --filter api storage:migrate                      (simulación: solo muestra el plan, no cambia nada)
 *   pnpm --filter api storage:migrate -- --apply           (copia y actualiza referencias en la BD)
 *   pnpm --filter api storage:migrate -- --apply --delete-old   (además borra los objetos antiguos sin referencias)
 * En Docker: docker compose exec api node dist/cli/storage-migrate.js [--apply [--delete-old]]
 * Es idempotente. Solo se ejecuta bajo petición del usuario; no imprime contenido.
 */
import { ConfigService } from '@nestjs/config';
import { createPgAdapter } from '../prisma/prisma.service';
import { PrismaClient } from '../generated/prisma/client';
import { StorageService } from '../storage/storage.service';
import { loadRootEnv } from './load-env';
import {
  migrateStorage,
  parseStorageMigrateArgs,
  type MigrateDb,
} from './storage-migrate-core';

loadRootEnv();

async function main() {
  const args = parseStorageMigrateArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'Uso: storage:migrate [--dry-run] [--apply] [--delete-old]\n' +
        '  (sin opciones)  simulación: muestra qué se movería, no cambia nada\n' +
        '  --apply         copia a hilos/<hilo>/pdf_<n>/ y actualiza la BD\n' +
        '  --delete-old    con --apply: borra los objetos antiguos que ya nadie referencia',
    );
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (.env raíz)');
  const prisma = new PrismaClient({ adapter: createPgAdapter(url) });
  const storage = new StorageService(new ConfigService());
  console.log(
    args.apply
      ? 'Migrando el almacenamiento al layout por hilo...'
      : 'SIMULACIÓN (no se cambia nada). Usa --apply para ejecutar.',
  );
  try {
    const s = await migrateStorage(prisma as unknown as MigrateDb, storage, {
      apply: args.apply,
      deleteOld: args.deleteOld,
      log: (l) => console.log(`  ${l}`),
    });
    console.log(
      `${args.apply ? 'Resultado' : 'Plan'}: ${s.pdfsMigrados} PDF(s), ${s.paginasCopiadas} página(s) por copiar/copiadas, ` +
        `${s.referenciasActualizadas} referencia(s) actualizadas, ${s.omitidos} omitido(s).`,
    );
    if (args.apply && args.deleteOld) {
      console.log(
        `Objetos antiguos borrados: ${s.objetosAntiguosBorrados}; conservados: ${s.objetosAntiguosPendientes}.`,
      );
    } else if (s.objetosAntiguosPendientes > 0) {
      console.log(
        `Quedan ${s.objetosAntiguosPendientes} objeto(s) antiguo(s); bórralos con --apply --delete-old cuando verifiques que todo se ve bien.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`Error: ${e instanceof Error ? e.message : 'desconocido'}`);
  process.exit(1);
});
