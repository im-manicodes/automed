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
import { MicrosoftService, OutlookConnectError } from './microsoft.service';
import { SessionGuard } from './session.guard';
import {
  SetupConflictError,
  UserInputError,
  UsersService,
} from '../users/users.service';

const CALLBACK_DONE_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Outlook conectado</title><style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f8fafc;color:#0f172a}main{max-width:28rem;padding:2rem;text-align:center}</style></head><body><main><h1>Listo</h1><p>Ya puedes volver a la aplicación.</p></main></body></html>`;
const callbackErrorHtml = (motivo: string) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No se pudo conectar</title><style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f8fafc;color:#0f172a}main{max-width:28rem;padding:2rem;text-align:center}</style></head><body><main><h1>No se pudo conectar Outlook</h1><p>${motivo.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</p><p>Vuelve a la aplicación e inténtalo de nuevo.</p></main></body></html>`;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly microsoft: MicrosoftService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  private isDesktop() {
    return this.config.get<string>('APP_MODE') === 'desktop';
  }

  /** Configuración inicial permitida: modo escritorio o SETUP_TOKEN válido (hosted). */
  private assertSetupAllowed(token: unknown) {
    if (this.isDesktop()) return;
    const expected = this.config.get<string>('SETUP_TOKEN') ?? '';
    if (expected && typeof token === 'string' && token) {
      const a = Buffer.from(token);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return;
    }
    throw new ForbiddenException('La configuración inicial no está permitida');
  }

  /** Cookie Secure: COOKIE_SECURE=true|false la fuerza; si no, se deduce de MS_REDIRECT_URI (https). */
  private secure() {
    const forced = this.config.get<string>('COOKIE_SECURE');
    if (forced === 'true' || forced === 'false') return forced === 'true';
    return (this.config.get<string>('MS_REDIRECT_URI') ?? '').startsWith(
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
      requiresToken: !this.isDesktop(),
    };
  }

  /**
   * Crea el primer usuario (solo si no existe ninguno; atómico) y abre sesión. Solo con
   * APP_MODE=desktop o con SETUP_TOKEN válido (cuerpo `setupToken` o cabecera `x-setup-token`).
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
    res.setHeader('Set-Cookie', this.auth.cookies(t, this.secure()));
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
    res.setHeader('Set-Cookie', this.auth.cookies(t, this.secure()));
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
      res.setHeader('Set-Cookie', this.auth.cookies(t, this.secure()));
      return { user: this.publicUser(t.user) };
    } catch (e) {
      res.setHeader('Set-Cookie', this.auth.clearCookies(this.secure()));
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
    res.setHeader('Set-Cookie', this.auth.clearCookies(this.secure()));
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
    if (this.isDesktop()) {
      return this.desktopCallback(code, state, error, res);
    }
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

  /**
   * Modo escritorio: el consentimiento ocurre en el navegador del sistema (sin la cookie de la
   * ventana). Se valida SOLO el state (JWT firmado, 10 min, ligado al usuario) y se responde una
   * página sencilla; la ventana de la app detecta la conexión consultando /mail/status.
   */
  private async desktopCallback(
    code: string | undefined,
    state: string | undefined,
    error: string | undefined,
    res: Response,
  ) {
    const page = (status: number, html: string) =>
      res
        .status(status)
        .type('html')
        .setHeader('Cache-Control', 'no-store')
        .send(html);
    if (error || typeof code !== 'string' || !code) {
      return page(400, callbackErrorHtml('Se canceló la conexión con Outlook'));
    }
    try {
      await this.microsoft.handleCallback(null, code, state);
    } catch (e) {
      return page(
        400,
        callbackErrorHtml(
          e instanceof OutlookConnectError
            ? e.message
            : 'No se pudo conectar con Outlook',
        ),
      );
    }
    return page(200, CALLBACK_DONE_HTML);
  }
}
