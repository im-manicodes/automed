import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Límite de intentos de login por IP + correo (el cuerpo ya viene parseado). */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const body = (req.body ?? {}) as { email?: unknown };
    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    return Promise.resolve(`${String(req.ip)}|${email}`);
  }

  protected throwThrottlingException(): Promise<void> {
    throw new HttpException(
      'Demasiados intentos. Espera un minuto e inténtalo de nuevo.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
