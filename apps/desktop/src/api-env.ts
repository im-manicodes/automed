import { join } from 'node:path';
import type { AppPaths } from './paths';
import type { Secrets } from './secrets';

export interface BuildConfig {
  msClientId?: string;
  msTenantId?: string;
}

export interface ApiEnvInput {
  paths: AppPaths;
  dataDir: string;
  port: number;
  databaseUrl: string;
  secrets: Secrets;
  buildConfig: BuildConfig;
  /** Variables base heredadas (se filtran: no se pasa nada sensible del entorno del usuario). */
  baseEnv?: NodeJS.ProcessEnv;
}

/** Variables del sistema que sí se heredan (rutas, idioma, proxy, temp). */
const INHERIT = [
  'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy', 'COMSPEC', 'PATHEXT',
];

/** Entorno del proceso de la API (puro). Los secretos nunca se registran. */
export function buildApiEnv(i: ApiEnvInput): Record<string, string> {
  const base = i.baseEnv ?? process.env;
  const env: Record<string, string> = {};
  for (const k of INHERIT) if (base[k]) env[k] = base[k] as string;
  Object.assign(env, {
    NODE_ENV: 'production',
    PORT: String(i.port),
    DATA_DIR: i.dataDir,
    DATABASE_URL: i.databaseUrl,
    JWT_SECRET: i.secrets.jwtSecret,
    TOKEN_ENC_KEY: i.secrets.tokenEncKey,
    FRONTEND_BUILD_PATH: i.paths.webDir,
    MS_CLIENT_ID: i.buildConfig.msClientId ?? '',
    MS_TENANT_ID: i.buildConfig.msTenantId || 'common',
    // La carpeta que contiene `app/` (el runner ejecuta `uvicorn app.main:app` con cwd ahí).
    OCR_LOCAL_APP_DIR: i.paths.ocrLocalDir,
    OCR_LOCAL_REQUIREMENTS: i.paths.ocrRequirements,
    PADDLE_PDX_CACHE_HOME: join(i.dataDir, 'python', 'models'),
    PDF_TEXT_MODE: 'node',
  });
  return env;
}

export function buildDatabaseUrl(password: string, port: number, db: string, user: string): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${db}`;
}
