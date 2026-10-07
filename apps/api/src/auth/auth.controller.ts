import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import type { AuthedRequest, AuthUser } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { ACCESS_COOKIE, REFRESH_COOKIE, parseCookie } from './cookies';
import { IpThrottlerGuard } from './ip-throttler.guard';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { MicrosoftSettingsService } from '../settings/microsoft-settings.service';
import { MicrosoftService, OutlookConnectError } from './microsoft.service';
import { SessionGuard } from './session.guard';
import {
  SetupConflictError,
  UserInputError,
  UsersService,
} from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly microsoft: MicrosoftService,
    private readonly msSettings: MicrosoftSettingsService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  /** Configuración inicial permitida solo con SETUP_TOKEN válido. */
  private assertSetupAllowed(token: unknown) {
    const expected = this.config.get<string>('SETUP_TOKEN') ?? '';
    if (expected && typeof token === 'string' && token) {
      const a = Buffer.from(token);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return;
    }
    throw new ForbiddenException('La configuración inicial no está permitida');
  }

  /** Cookie Secure: COOKIE_SECURE=true|false la fuerza; si no, se deduce de la URI de redirección efectiva (https). */
  private async secure() {
    const forced = this.config.get<string>('COOKIE_SECURE');
    if (forced === 'true' || forced === 'false') return forced === 'true';
    return (await this.msSettings.getEffective()).redirectUri.startsWith(
      'https',
    );
  }

  private ua(req: AuthedRequest) {
    return req.headers['user-agent'];
  }

  private publicUser(u: AuthUser) {
    return { id: u.id, email: u.email, nombre: u.nombre };
  }

  /** Público: ¿falta crear el primer usuario? (`requiresToken`: en hosted se pide SETUP_TOKEN). */
  @Get('setup-status')
  @UseGuards(IpThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async setupStatus() {
    return {
      needsSetup: await this.users.needsSetup(),
      requiresToken: true,
    };
  }

  /**
   * Crea el primer usuario (solo si no existe ninguno; atómico) y abre sesión. Solo con
   * SETUP_TOKEN válido (cuerpo `setupToken` o cabecera `x-setup-token`).
   */
  @Post('setup')
  @HttpCode(200)
  @UseGuards(IpThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async setup(
    @Body()
    body: {
      email?: unknown;
      nombre?: unknown;
      password?: unknown;
      setupToken?: unknown;
    },
    @Headers('x-setup-token') headerToken: string | undefined,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertSetupAllowed(headerToken ?? body?.setupToken);
    if (
      typeof body?.email !== 'string' ||
      typeof body?.nombre !== 'string' ||
      typeof body?.password !== 'string'
    ) {
      throw new BadRequestException('Faltan datos');
    }
    let created;
    try {
      created = await this.users.createFirstUser({
        email: body.email,
        nombre: body.nombre,
        password: body.password,
      });
    } catch (e) {
      if (e instanceof SetupConflictError) {
        throw new ConflictException('La configuración inicial ya se hizo');
      }
      if (e instanceof UserInputError) throw new BadRequestException(e.message);
      throw e;
    }
    const u = created.user;
    const t = await this.auth.startSession(
      { id: u.id, email: u.email, nombre: u.nombre },
      this.ua(req),
    );
    res.setHeader('Set-Cookie', this.auth.cookies(t, await this.secure()));
    return { user: this.publicUser(t.user) };
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() body: { email?: unknown; password?: unknown },
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const t = await this.auth.login(body?.email, body?.password, this.ua(req));
    res.setHeader('Set-Cookie', this.auth.cookies(t, await this.secure()));
    return { user: this.publicUser(t.user) };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const t = await this.auth.refresh(
        parseCookie(req.headers.cookie, REFRESH_COOKIE),
        this.ua(req),
      );
      res.setHeader('Set-Cookie', this.auth.cookies(t, await this.secure()));
      return { user: this.publicUser(t.user) };
    } catch (e) {
      res.setHeader('Set-Cookie', this.auth.clearCookies(await this.secure()));
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(parseCookie(req.headers.cookie, REFRESH_COOKIE));
    res.setHeader('Set-Cookie', this.auth.clearCookies(await this.secure()));
  }

  /** Público: solo informa si hay sesión (nunca 401). */
  @Get('me')
  me(@Req() req: AuthedRequest) {
    const user = this.auth.verifyAccess(
      parseCookie(req.headers.cookie, ACCESS_COOKIE),
    );
    return user
      ? { authenticated: true, user: this.publicUser(user) }
      : { authenticated: false };
  }

  @Post('change-password')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: { actual?: unknown; nueva?: unknown },
    @Req() req: AuthedRequest,
  ) {
    await this.auth.changePassword(
      user.id,
      body?.actual,
      body?.nueva,
      parseCookie(req.headers.cookie, REFRESH_COOKIE),
    );
  }

  /**
   * Retorno de Microsoft (misma URI registrada en Entra). Exige sesión de la app del mismo
   * usuario que inició la conexión; siempre redirige a Ajustes con el resultado.
   */
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    const web = this.config.get<string>('WEB_ORIGIN') ?? '';
    const fail = (motivo: string) =>
      res.redirect(
        `${web}/ajustes?outlook=error&motivo=${encodeURIComponent(motivo)}`,
      );
    const user = this.auth.verifyAccess(
      parseCookie(req.headers.cookie, ACCESS_COOKIE),
    );
    if (!user)
      return fail('Tu sesión caducó; inicia sesión e inténtalo de nuevo');
    if (error || typeof code !== 'string' || !code) {
      return fail('Se canceló la conexión con Outlook');
    }
    try {
      await this.microsoft.handleCallback(user.id, code, state);
    } catch (e) {
      return fail(
        e instanceof OutlookConnectError
          ? e.message
          : 'No se pudo conectar con Outlook',
      );
    }
    return res.redirect(`${web}/ajustes?outlook=conectado`);
  }
}
