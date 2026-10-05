import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/** Configuración común (main.ts y pruebas e2e): prefijo, CORS, cabeceras de seguridad y límites de cuerpo. */
export function configureApp(
  app: INestApplication,
  webOrigin = process.env.WEB_ORIGIN,
) {
  const a = app as NestExpressApplication;
  a.setGlobalPrefix('api');
  // CORS solo para el origen del front (nunca "cualquier origen" con credenciales).
  a.enableCors({
    origin: webOrigin || 'http://localhost:5173',
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
  a.disable('x-powered-by');
  // Límite explícito de cuerpo (las plantillas y correcciones son texto corto).
  a.useBodyParser('json', { limit: '256kb' });
  a.useBodyParser('urlencoded', { limit: '64kb', extended: false });
  return a;
}
