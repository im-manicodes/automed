import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
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
