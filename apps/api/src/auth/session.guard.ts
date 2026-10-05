import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from './session.service';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = this.sessions.parseCookie(req.headers.cookie);
    if (!this.sessions.verify(token)) {
      throw new UnauthorizedException('Inicia sesión con Microsoft');
    }
    return true;
  }
}
