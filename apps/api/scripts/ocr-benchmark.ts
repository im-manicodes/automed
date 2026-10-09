/**
 * Benchmark de OCR sobre un directorio de PDFs.
 *
 *   pnpm --filter api ocr:benchmark -- <directorio> [--engine local|textract] [--dpi 250]
 *                                      [--threshold 0.85] [--max-pages N] [--csv salida.csv]
 *
 * Usa el motor elegido (OCR_ENGINE del .env raíz, o --engine) y reporta por documento:
 * páginas, nº de palabras/líneas, confianza media, % de regiones dudosas y tiempo.
 * No guarda nada en BD ni en RustFS y NO imprime el texto de los documentos.
 */
import { config as loadEnv } from 'dotenv';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { LocalOcrEngineService } from '../src/ocr/local-ocr-engine.service';
import { TextractOcrEngineService } from '../src/ocr/textract-ocr-engine.service';
import type { AiSettingsService } from '../src/settings/ai-settings.service';
import { PdfRasterizerService } from '../src/ocr/pdf-rasterizer.service';
import {
  classifyRegions,
  meanConfidence,
  regionsOf,
} from '../src/ocr/ocr-classifier';
import { readOcrConfig } from '../src/ocr/ocr-config';

loadEnv({ path: resolve(__dirname, '../../../.env') });

function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i] ?? '';
    else pos.push(argv[i]);
  }
  return { flags, dir: pos[0] };
}

async function main() {
  const { flags, dir } = parseArgs(process.argv.slice(2));
  if (!dir) {
    console.error(
      'Uso: ocr-benchmark <directorio-de-pdfs> [--engine local|textract] [--dpi N] [--threshold X] [--max-pages N] [--csv archivo]',
    );
    process.exit(1);
  }
  const env: Record<string, string | undefined> = { ...process.env };
  if (flags.engine) env.OCR_ENGINE = flags.engine;
  if (flags.dpi) env.OCR_RENDER_DPI = flags.dpi;
  if (flags.threshold) env.OCR_CONFIDENCE_THRESHOLD = flags.threshold;
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const cfg = readOcrConfig(config);
  const maxPages = flags['max-pages'] ? Number(flags['max-pages']) : Infinity;

  const rasterizer = new PdfRasterizerService({
    getEffective: () => Promise.resolve({ renderDpi: cfg.dpi }),
  } as never);
  const engine =
    cfg.engine === 'textract'
      ? new TextractOcrEngineService(config, {
          // Sin Nest ni BD: región del env y credenciales de la cadena por defecto de AWS.
          getEffective: () => Promise.resolve({ awsRegion: cfg.awsRegion }),
          getAwsCredentials: () => Promise.resolve(undefined),
        } as unknown as AiSettingsService)
      : new LocalOcrEngineService(config);

  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();
  console.log(
    `Motor: ${engine.name} | DPI: ${cfg.dpi} | umbral: ${cfg.confidenceThreshold} | PDFs: ${files.length}`,
  );

  const rows: (string | number)[][] = [];
  for (const f of files) {
    const t0 = Date.now();
    try {
      const pages = (
        await rasterizer.rasterize(new Uint8Array(readFileSync(join(dir, f))))
      ).slice(0, maxPages);
      let words = 0;
      const regions: { confidence: number; status: string }[] = [];
      for (const p of pages) {
        const res = await engine.recognize(p.png, p.pageNumber);
        words += res.words.length || res.lines?.length || 0;
        regions.push(
          ...classifyRegions(regionsOf(res), cfg.confidenceThreshold),
        );
      }
      const doubtful = regions.filter((r) => r.status === 'dudoso').length;
      rows.push([
        f,
        pages.length,
        words,
        regions.length,
        +meanConfidence(regions).toFixed(3),
        regions.length ? +((100 * doubtful) / regions.length).toFixed(1) : 0,
        +((Date.now() - t0) / 1000).toFixed(1),
      ]);
    } catch (e) {
      rows.push([f, 0, 0, 0, 0, 0, +((Date.now() - t0) / 1000).toFixed(1)]);
      console.error(`ERROR en ${f}: ${(e as Error).message}`);
    }
  }
  const header = [
    'documento',
    'paginas',
    'palabras',
    'regiones',
    'conf_media',
    'pct_dudosas',
    'segundos',
  ];
  console.table(
    rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))),
  );
  if (flags.csv) {
    writeFileSync(
      flags.csv,
      [header, ...rows].map((r) => r.join(',')).join('\n') + '\n',
    );
    console.log(`CSV: ${flags.csv}`);
  }
}

void main();
