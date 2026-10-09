import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, serveFrontend } from './app.setup';
import { AppLogger } from './logs/app-logger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    // Los mensajes del arranque se retienen hasta instalar AppLogger (stdout + Ajustes -> Registro).
    bufferLogs: true,
  });
  app.useLogger(app.get(AppLogger));
  // Imagen única: la API sirve también el front compilado (antes de helmet; ver serveFrontend).
  if (process.env.FRONTEND_BUILD_PATH) {
    serveFrontend(app, process.env.FRONTEND_BUILD_PATH);
  }
  configureApp(app);
  // Detrás de un proxy (Dokku, nginx, Caddy): respeta X-Forwarded-* (cookies Secure, IP).
  app.set('trust proxy', 1);
  // SIGTERM/SIGINT -> onModuleDestroy: el supervisor detiene el OCR local antes de salir.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
