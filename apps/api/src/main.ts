import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  configureApp(app);
  // Detrás de nginx (web) o un proxy: respeta X-Forwarded-* (cookies Secure, IP).
  app.set('trust proxy', 1);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
