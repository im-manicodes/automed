/**
 * Punto de entrada del modo ESCRITORIO (Electron). Electron lo lanza como proceso hijo
 * (`utilityProcess.fork('<resources>/api/dist/main-desktop.js')`) o lo importa y llama a
 * `startServer`. Nada se lee de archivos `.env`: toda la configuración llega por variables de entorno.
 *
 * Variables que Electron debe pasar (además de PORT y DATA_DIR para el proceso hijo):
 *   PORT              puerto de la API (127.0.0.1); solo el entrypoint hijo
 *   DATA_DIR          carpeta de datos del usuario (`userData`); solo el entrypoint hijo
 *   DATABASE_URL      Postgres embebido (postgresql://...@127.0.0.1:<puerto>/<bd>)
 *   JWT_SECRET        >= 32 caracteres (generado en el primer arranque, guardado con safeStorage)
 *   TOKEN_ENC_KEY     clave AES-GCM (base64, 32 bytes) para cifrar tokens y claves
 *   FRONTEND_BUILD_PATH  carpeta del front compilado (apps/web/dist empaquetado)
 *   MS_CLIENT_ID      (opcional) client id de Entra ID "Mobile and desktop applications"; MS_TENANT_ID
 *                     (por defecto common). MS_CLIENT_SECRET no se usa (cliente público + PKCE).
 *   PDF_TEXT_MODE     (opcional) por defecto `node`
 *   PDF_EXTRACT_URL, OCR_*, etc. (opcionales; el OCR y la IA se eligen desde la web)
 *
 * Variables que fija este módulo (pisan lo recibido): APP_MODE=desktop, STORAGE_DRIVER=fs,
 * DATA_DIR, PORT, WEB_ORIGIN=http://localhost:<puerto>, COOKIE_SECURE=false.
 * MS_REDIRECT_URI no hace falta: en modo escritorio se arma como http://localhost:<puerto>/api/auth/callback.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { configureApp, serveFrontend } from './app.setup';

export interface DesktopOptions {
  port: number;
  dataDir: string;
  env?: Record<string, string>;
}

export interface DesktopServer {
  port: number;
  close(): Promise<void>;
}

/** Calcula las variables de entorno del modo escritorio (pura; no toca process.env). */
export function buildDesktopEnv(
  opts: DesktopOptions,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return {
    PDF_TEXT_MODE: 'node',
    ...(Object.fromEntries(
      Object.entries(base).filter(([, v]) => v !== undefined),
    ) as Record<string, string>),
    ...(opts.env ?? {}),
    APP_MODE: 'desktop',
    STORAGE_DRIVER: 'fs',
    DATA_DIR: resolve(opts.dataDir),
    PORT: String(opts.port),
    WEB_ORIGIN: `http://localhost:${opts.port}`,
    COOKIE_SECURE: 'false',
  };
}

export async function startServer(
  opts: DesktopOptions,
): Promise<DesktopServer> {
  Object.assign(process.env, buildDesktopEnv(opts));
  // Se importa DESPUÉS de fijar el entorno: varios módulos leen la configuración al crearse.
  const { AppModule } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./app.module') as typeof import('./app.module.js');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  if (process.env.FRONTEND_BUILD_PATH) {
    serveFrontend(app, process.env.FRONTEND_BUILD_PATH);
  }
  configureApp(app, process.env.WEB_ORIGIN);
  await app.listen(opts.port, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo | null;
  return {
    port: address?.port ?? opts.port,
    close: () => app.close(),
  };
}

/** Proceso hijo: lee PORT y DATA_DIR del entorno, arranca y se detiene con SIGTERM/SIGINT o `shutdown`. */
async function main() {
  const port = Number(process.env.PORT);
  const dataDir = process.env.DATA_DIR;
  if (!Number.isInteger(port) || port < 0 || !dataDir) {
    throw new Error('Faltan PORT y DATA_DIR en el entorno');
  }
  const server = await startServer({ port, dataDir });
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const parent = (
    process as unknown as {
      parentPort?: {
        postMessage(m: unknown): void;
        on(e: 'message', cb: (m: { data?: unknown }) => void): void;
      };
    }
  ).parentPort;
  parent?.on('message', (m) => {
    if (m?.data === 'shutdown') stop();
  });
  parent?.postMessage({ type: 'ready', port: server.port });
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(
      `No se pudo iniciar el servidor: ${e instanceof Error ? e.message : 'error desconocido'}`,
    );
    process.exit(1);
  });
}
