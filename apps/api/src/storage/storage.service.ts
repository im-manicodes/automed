/**
 * Abstracción del almacenamiento de objetos (PDFs, páginas, reportes). Es una clase abstracta para
 * que sirva a la vez de tipo y de token de inyección: los consumidores siguen inyectando
 * `StorageService`; `StorageModule` elige la implementación según `STORAGE_DRIVER` (s3 | fs).
 */
export abstract class StorageService {
  /** Comprobación ligera para /api/health. */
  abstract isHealthy(): Promise<boolean>;

  /** `metadata` (opcional): pares clave/valor ASCII (p. ej. filename, sha256); el driver fs los ignora. */
  abstract put(
    key: string,
    body: Buffer | Uint8Array,
    contentType?: string,
    metadata?: Record<string, string>,
  ): Promise<void>;

  /** Copia un objeto dentro del mismo almacenamiento. */
  abstract copy(srcKey: string, dstKey: string): Promise<void>;

  /** ¿Existe el objeto? */
  abstract exists(key: string): Promise<boolean>;

  /** Borra un objeto concreto (no falla si no existe). */
  abstract delete(key: string): Promise<void>;

  abstract get(key: string): Promise<Uint8Array>;

  /** Borra solo los objetos cuya clave empieza por `prefix` (no vacío). Devuelve cuántos borró. */
  abstract deleteByPrefix(prefix: string): Promise<number>;
}
