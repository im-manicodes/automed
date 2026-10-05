import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  /** Cookie Secure: COOKIE_SECURE=true|false la fuerza; si no, se deduce de MS_REDIRECT_URI (https). */
  private secure() {
    const forced = this.config.get<string>('COOKIE_SECURE');
    if (forced === 'true' || forced === 'false') return forced === 'true';
    return (this.config.get<string>('MS_REDIRECT_URI') ?? '').startsWith(
      'https',
    );
  }

  @Get('login')
  login(@Res() res: Response) {
    res.redirect(this.auth.buildLoginUrl());
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    if (error || !code) throw new UnauthorizedException('Login cancelado');
    const email = await this.auth.handleCallback(code, state);
    res.setHeader(
      'Set-Cookie',
      this.sessions.cookieHeader(this.sessions.create(email), this.secure()),
    );
    res.redirect(this.config.get<string>('WEB_ORIGIN') ?? '/');
  }

  @Get('me')
  me(@Req() req: Request) {
    const s = this.sessions.verify(
      this.sessions.parseCookie(req.headers.cookie),
    );
    return s
      ? { authenticated: true, email: s.email }
      : { authenticated: false };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.setHeader(
      'Set-Cookie',
      this.sessions.cookieHeader('', this.secure(), true),
    );
    return { ok: true };
  }
}
