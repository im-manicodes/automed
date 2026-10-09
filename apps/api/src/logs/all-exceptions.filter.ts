import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';

function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  // Errores tipo http-errors (statusCode + message): el filtro base los respeta.
  const code = (exception as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === 'number' ? code : HttpStatus.INTERNAL_SERVER_ERROR;
}

/**
 * Filtro global (APP_FILTER en LogsModule): registra los errores 5xx con método, ruta (sin query),
 * estado y nombre/mensaje del error. Nunca registra cuerpo, query, cabeceras ni cookies. La
 * respuesta la sigue construyendo el filtro base de Nest.
 */
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Errores');

  override catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return super.catch(exception, host);
    const status = statusOf(exception);
    if (status >= 500) {
      const req = host.switchToHttp().getRequest<Request>();
      const detalle =
        exception instanceof Error
          ? `${exception.name}: ${exception.message}`
          : 'Error desconocido';
      this.logger.error(
        `${req.method} ${req.path} -> ${status} ${detalle}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }
    const known =
      exception instanceof HttpException ||
      typeof (exception as { statusCode?: unknown } | null)?.statusCode ===
        'number';
    // Error no controlado: ya quedó registrado arriba; se responde el 500 genérico de siempre
    // sin que el filtro base lo vuelva a registrar.
    return super.catch(
      known
        ? exception
        : new InternalServerErrorException('Internal server error'),
      host,
    );
  }
}
