import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';

/**
 * Python autónomo (python-build-standalone, astral-sh). Versión y sha256 FIJADOS: el instalador
 * rechaza cualquier descarga cuyo sha256 no coincida. Cambiar la versión invalida el venv (marcador).
 */
export const PYTHON_VERSION = '3.11.10';
export const PYTHON_BUILD = '20241016';
export const PYTHON_DOWNLOADS: Record<string, { url: string; sha256: string }> =
  {
    x64: {
      url: `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_BUILD}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
      sha256:
        '8b50a442b04724a24c1eebb65a36a0c0e833d35374dbdf9c9470d8a97b164cd9',
    },
    arm64: {
      url: `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_BUILD}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD}-aarch64-unknown-linux-gnu-install_only.tar.gz`,
      sha256:
        '803e49259280af0f5466d32829cd9d65a302b0226e424b3f0b261f9daf6aee8f',
    },
  };

/** OpenCV sin GUI (no necesita libGL); misma versión que resuelve paddlex 3.0.3. */
export const OPENCV_HEADLESS = 'opencv-contrib-python-headless==4.10.0.84';
export const OPENCV_VARIANTS = [
  'opencv-contrib-python',
  'opencv-python',
  'opencv-python-headless',
  'opencv-contrib-python-headless',
];

/** Dónde escucha el OCR gestionado por la API (solo en el propio contenedor). */
export const MANAGED_HOST = '127.0.0.1';
export const MANAGED_PORT = 8000;

/** Espacio libre mínimo para instalar (Python + venv con Paddle + modelos). */
export const MIN_FREE_BYTES = 4 * 1024 ** 3;

export interface OcrLocalPaths {
  home: string;
  python: string;
  pythonBin: string;
  pythonMarker: string;
  code: string;
  requirements: string;
  venv: string;
  venvTmp: string;
  venvOld: string;
  venvPython: string;
  /** Caché de modelos de PaddleOCR (se conserva al desinstalar). */
  models: string;
  asset: string;
}

/** Ubicación del código del OCR empaquetado (scripts/build-ocr-asset.mjs). */
export function resolveOcrAsset(override?: string): string {
  if (override) return resolve(override);
  const candidates = [
    // dist/ocr -> dist/assets (copiado por el build)
    resolve(__dirname, '..', 'assets', 'ocr-local.tgz'),
    // src/ocr o dist/ocr -> apps/api/assets
    resolve(__dirname, '..', '..', 'assets', 'ocr-local.tgz'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[1];
}

/** Rutas del OCR gestionado. `OCR_HOME` (por defecto /models) permite aislarlas en pruebas. */
export function ocrLocalPaths(
  config: Pick<ConfigService, 'get'>,
): OcrLocalPaths {
  const home = resolve(config.get<string>('OCR_HOME') || '/models');
  const python = join(home, 'python');
  const code = join(home, 'ocr-local');
  const venv = join(home, 'venv');
  return {
    home,
    python,
    pythonBin: join(python, 'bin', 'python3'),
    pythonMarker: join(python, '.automed-version'),
    code,
    requirements: join(code, 'requirements.txt'),
    venv,
    venvTmp: join(home, 'venv.tmp'),
    venvOld: join(home, 'venv.old'),
    // Siempre `python -m ...`: los scripts de bin/ llevan la ruta de venv.tmp en el shebang.
    venvPython: join(venv, 'bin', 'python'),
    models: home,
    asset: resolveOcrAsset(config.get<string>('OCR_ASSET_PATH')),
  };
}

/**
 * ¿La API gestiona el OCR local? No, si OCR_LOCAL_URL apunta a un servicio externo
 * (p. ej. el contenedor ocr-local del compose de desarrollo) o si OCR_LOCAL_MANAGED=false.
 */
export function isOcrManaged(config: Pick<ConfigService, 'get'>): boolean {
  if (config.get<string>('OCR_LOCAL_MANAGED') === 'false') return false;
  const raw = config.get<string>('OCR_LOCAL_URL');
  if (!raw) return true;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    return (
      ['127.0.0.1', 'localhost', '::1'].includes(host) && port === MANAGED_PORT
    );
  } catch {
    return false;
  }
}

/**
 * Entorno MÍNIMO para los procesos de Python: nunca se hereda process.env completo
 * (llevaría JWT_SECRET, DATABASE_URL, claves...). Solo PATH/HOME/idioma y proxy si lo hay.
 */
export function pythonEnv(
  paths: OcrLocalPaths,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: `${join(paths.python, 'bin')}:/usr/local/bin:/usr/bin:/bin`,
    HOME: process.env.HOME ?? paths.home,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUNBUFFERED: '1',
    PIP_NO_CACHE_DIR: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PIP_NO_INPUT: '1',
    PADDLE_PDX_CACHE_HOME: paths.models,
    OCR_LOCAL_ENGINE: 'paddle',
    OCR_LANG: 'es',
    // Sin Tesseract en la imagen: en modo gestionado no hay respaldo.
    OCR_FALLBACK: 'false',
    ...extra,
  };
  for (const k of [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
  ]) {
    if (process.env[k]) env[k] = process.env[k];
  }
  return env;
}
