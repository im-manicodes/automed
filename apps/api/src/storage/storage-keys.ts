/**
 * Layout de RustFS por hilo (puro, sin dependencias):
 *   hilos/<threadId>/pdf_<n>/original.pdf
 *   hilos/<threadId>/pdf_<n>/pagina_<k>.png
 * La carpeta de un PDF es dirname(storageKey); el nombre original vive en Attachment.filename.
 */
export const THREADS_ROOT = 'hilos';

const PDF_DIR_RE = /^(.*\/)?pdf_(\d+)\/[^/]+$/;

/** Carpeta del PDF n-ésimo del hilo (sin barra final). `root` permite prefijos (p. ej. `demo/`). */
export const pdfFolder = (threadId: string, n: number, root = '') =>
  `${root}${THREADS_ROOT}/${threadId}/pdf_${n}`;

export const pdfKey = (threadId: string, n: number, root = '') =>
  `${pdfFolder(threadId, n, root)}/original.pdf`;

/** Clave de la imagen de la página `pageNumber` en la carpeta del PDF dueño de `storageKey`. */
export const pageKey = (storageKey: string, pageNumber: number) => {
  const i = storageKey.lastIndexOf('/');
  const dir = i >= 0 ? storageKey.slice(0, i) : '';
  return `${dir ? `${dir}/` : ''}pagina_${pageNumber}.png`;
};

/** ¿La clave sigue el layout nuevo (`.../pdf_<n>/<archivo>`)? Las antiguas (`attachments/<sha>.pdf`) no. */
export const isFolderKey = (storageKey: string) => PDF_DIR_RE.test(storageKey);

/** Como pageKey, pero null si la clave es del layout antiguo (no hay carpeta propia). */
export const ownPageKey = (storageKey: string, pageNumber: number) =>
  isFolderKey(storageKey) ? pageKey(storageKey, pageNumber) : null;

/** Siguiente índice libre (máximo existente + 1; robusto ante huecos). Ignora claves antiguas. */
export const nextPdfIndex = (existingKeys: readonly string[]) => {
  let max = 0;
  for (const k of existingKeys) {
    const m = PDF_DIR_RE.exec(k);
    if (m) max = Math.max(max, Number(m[2]));
  }
  return max + 1;
};
