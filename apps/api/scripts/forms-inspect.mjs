#!/usr/bin/env node
// Inspector de solo lectura de formularios PDF (AcroForm).
// Recorre las anotaciones /Widget de cada página con pdfjs-dist (no usa pdf-lib getFields,
// que falla con referencias nulas en /Fields) y muestra, por widget: página, nombre completo
// del campo, tipo, rect y el texto impreso más cercano (a la izquierda o arriba).
//
// Uso: node scripts/forms-inspect.mjs [--json] [archivo.pdf ...]
// Sin archivos usa docs/formatos/*.pdf de la raíz del monorepo.

import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const LEFT_MAX_GAP = 150; // pt, distancia máxima horizontal al texto de la izquierda
const ABOVE_MAX_GAP = 30; // pt, distancia máxima vertical al texto de arriba
const SAME_LINE_TOL = 2; // pt de tolerancia vertical

const FORMATOS_DIR = fileURLToPath(new URL('../../../docs/formatos/', import.meta.url));

const args = process.argv.slice(2);
const asJson = args.includes('--json');
let paths = args.filter((a) => !a.startsWith('--'));
if (paths.length === 0) {
  const entries = await readdir(FORMATOS_DIR);
  paths = entries
    .filter((f) => extname(f).toLowerCase() === '.pdf')
    .sort()
    .map((f) => resolve(FORMATOS_DIR, f));
}

// Tipo de campo legible a partir de /FT y de los flags (pdf.js ya resuelve la herencia de /FT).
function tipoCampo(ann) {
  const flags = ann.fieldFlags ?? 0;
  switch (ann.fieldType) {
    case 'Tx':
      return 'Tx (texto)';
    case 'Ch':
      return flags & (1 << 17) ? 'Ch (combo)' : 'Ch (lista)';
    case 'Sig':
      return 'Sig (firma)';
    case 'Btn':
      if (flags & (1 << 15)) return 'Btn radio';
      if (flags & (1 << 16)) return 'Btn pulsador';
      return 'Btn checkbox';
    default:
      return ann.fieldType ? String(ann.fieldType) : '(sin /FT)';
  }
}

// Texto impreso más cercano: a la izquierda en la misma línea o justo encima.
function textoCercano(rect, items) {
  const [rx1, ry1, rx2, ry2] = rect;
  const cy = (ry1 + ry2) / 2;
  let mejorIzq = null;
  let mejorArr = null;
  for (const it of items) {
    if (!it.str.trim()) continue;
    const { x0, x1, y0, y1 } = it;
    // Izquierda: el texto termina antes (o cerca) del inicio del rect y la línea cruza el centro del rect.
    if (x1 <= rx1 + SAME_LINE_TOL && cy >= y0 - SAME_LINE_TOL && cy <= y1 + SAME_LINE_TOL) {
      const gap = rx1 - x1;
      if (gap <= LEFT_MAX_GAP && (!mejorIzq || gap < mejorIzq.gap)) mejorIzq = { gap, str: it.str };
    }
    // Arriba: el texto está por encima del rect y se solapa horizontalmente con él.
    if (y0 >= ry2 - SAME_LINE_TOL && x0 < rx2 && x1 > rx1) {
      const gap = y0 - ry2;
      if (gap <= ABOVE_MAX_GAP && (!mejorArr || gap < mejorArr.gap)) mejorArr = { gap, str: it.str };
    }
  }
  if (mejorIzq) return `izq: "${mejorIzq.str.trim()}"`;
  if (mejorArr) return `arriba: "${mejorArr.str.trim()}"`;
  return '(sin texto cercano)';
}

async function inspeccionar(ruta) {
  const data = new Uint8Array(await readFile(ruta));
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  }).promise;

  const filas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const anns = (await page.getAnnotations()).filter((a) => a.subtype === 'Widget');
    if (anns.length === 0) continue;
    const texto = await page.getTextContent();
    const items = texto.items
      .filter((it) => 'str' in it && it.str.trim())
      .map((it) => {
        const h = it.height || Math.abs(it.transform[3]) || 8;
        const x0 = it.transform[4];
        const y0 = it.transform[5];
        return { str: it.str, x0, x1: x0 + (it.width || 0), y0, y1: y0 + h };
      });
    anns.forEach((ann, i) => {
      const rect = ann.rect.map((v) => Math.round(v));
      filas.push({
        pagina: p,
        orden: i + 1,
        campo: ann.fieldName || '(sin nombre)',
        tipo: tipoCampo(ann),
        rect,
        textoCercano: textoCercano(ann.rect, items),
      });
    });
  }
  await doc.destroy();
  return { archivo: basename(ruta), paginas: doc.numPages, widgets: filas };
}

function tabla(filas) {
  const cab = ['pag', 'campo', 'tipo', 'rect [x1,y1,x2,y2]', 'texto cercano'];
  const celdas = filas.map((f) => [
    String(f.pagina),
    f.campo,
    f.tipo,
    `[${f.rect.join(',')}]`,
    f.textoCercano,
  ]);
  const anchos = cab.map((c, i) => Math.max(c.length, ...celdas.map((r) => r[i].length)));
  const linea = (r) => r.map((c, i) => c.padEnd(anchos[i])).join('  ');
  return [linea(cab), anchos.map((n) => '-'.repeat(n)).join('  '), ...celdas.map(linea)].join('\n');
}

const resultados = [];
let fallos = 0;
for (const ruta of paths) {
  try {
    resultados.push(await inspeccionar(ruta));
  } catch (err) {
    fallos++;
    resultados.push({ archivo: basename(ruta), error: err?.message ?? String(err) });
  }
}

if (asJson) {
  console.log(JSON.stringify(resultados, null, 2));
} else {
  for (const r of resultados) {
    console.log(`=== ${r.archivo} ===`);
    if (r.error) {
      console.log(`ERROR: ${r.error}\n`);
      continue;
    }
    console.log(`páginas: ${r.paginas}  widgets: ${r.widgets.length}\n`);
    if (r.widgets.length) console.log(tabla(r.widgets));
    console.log('');
  }
}
process.exitCode = fallos ? 1 : 0;
