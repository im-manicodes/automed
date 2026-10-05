import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import type { AuthedRequest } from './auth.types';
import { ACCESS_COOKIE, parseCookie } from './cookies';

/** Exige un JWT de acceso válido (cookie HttpOnly) y deja el usuario en `req.user`. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = this.auth.verifyAccess(
      parseCookie(req.headers.cookie, ACCESS_COOKIE),
    );
    if (!user) throw new UnauthorizedException('Inicia sesión');
    req.user = user;
    return true;
  }
}
