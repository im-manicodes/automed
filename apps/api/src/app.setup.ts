import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

/**
 * Defensa CSRF adicional a SameSite=Lax: las rutas mutantes validan el Origin (si viene) contra
 * WEB_ORIGIN y, si traen cuerpo, exigen Content-Type JSON.
 */
export function mutationGuard(allowedOrigin: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && origin !== allowedOrigin) {
      return res
        .status(403)
        .json({ statusCode: 403, message: 'Origen no permitido' });
    }
    const hasBody =
      Number(req.headers['content-length'] ?? 0) > 0 ||
      req.headers['transfer-encoding'] !== undefined;
    if (hasBody && !req.is('application/json')) {
      return res
        .status(415)
        .json({ statusCode: 415, message: 'Se requiere Content-Type JSON' });
    }
    next();
  };
}

/** Configuración común (main.ts y pruebas e2e): prefijo, CORS, cabeceras de seguridad y límites de cuerpo. */
export function configureApp(
  app: INestApplication,
  webOrigin = process.env.WEB_ORIGIN,
) {
  const a = app as NestExpressApplication;
  a.setGlobalPrefix('api');
  // CORS solo para el origen del front (nunca "cualquier origen" con credenciales).
  const allowed = webOrigin || 'http://localhost:5173';
  a.enableCors({
    origin: allowed,
    credentials: true,
  });
  // La API solo sirve JSON e imágenes al mismo sitio; sin CSP de documentos.
  a.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
    }),
  );
  a.use(mutationGuard(allowed));
  a.disable('x-powered-by');
  // Límite explícito de cuerpo (las plantillas y correcciones son texto corto).
  a.useBodyParser('json', { limit: '256kb' });
  a.useBodyParser('urlencoded', { limit: '64kb', extended: false });
  return a;
}

/**
 * Sirve el front compilado (Vite) desde la propia API cuando existe `FRONTEND_BUILD_PATH`
 * (imagen única de producción). Debe llamarse ANTES de `configureApp`: así el helmet de la API
 * (CSP `default-src 'none'`, solo para JSON) no se aplica al HTML/JS/CSS del front. Todo lo que no
 * empieza por /api y no es un archivo cae en index.html (rutas de react-router).
 */
export function serveFrontend(app: INestApplication, dir: string) {
  const root = resolve(dir);
  const index = join(root, 'index.html');
  if (!existsSync(index)) {
    throw new Error(`FRONTEND_BUILD_PATH sin index.html: ${root}`);
  }
  const a = app as NestExpressApplication;
  // Mismas cabeceras que ponía el nginx del contenedor `web`.
  a.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  a.useStaticAssets(root, {
    index: false,
    // Los archivos con hash (assets/) no cambian nunca; el resto (index, sw.js, manifest) se revalida.
    setHeaders: (res: Response, filePath: string) => {
      res.setHeader(
        'Cache-Control',
        filePath.includes(join(root, 'assets'))
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      );
    },
  });
  a.use((req: Request, res: Response, next: NextFunction) => {
    if (
      (req.method !== 'GET' && req.method !== 'HEAD') ||
      req.path === '/api' ||
      req.path.startsWith('/api/')
    ) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
