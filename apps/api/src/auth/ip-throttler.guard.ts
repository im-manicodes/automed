import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { clientIp } from './client-ip';

/** Límite por IP (rutas públicas de configuración inicial), con mensaje en español. */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(clientIp(req));
  }

  protected throwThrottlingException(): Promise<void> {
    throw new HttpException(
      'Demasiados intentos. Espera un minuto e inténtalo de nuevo.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
