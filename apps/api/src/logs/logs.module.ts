import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { LogBufferService } from './log-buffer.service';
import { LogsController } from './logs.controller';
import { AppLogger } from './app-logger';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** Registro de la API en memoria (Ajustes -> Registro). Global: cualquiera puede inyectar el buffer. */
@Global()
@Module({
  imports: [AuthModule],
  providers: [
    LogBufferService,
    AppLogger,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  controllers: [LogsController],
  exports: [LogBufferService, AppLogger],
})
export class LogsModule {}
