import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TokenCryptoService } from './token-crypto.service';

const SCOPES = 'offline_access Mail.Read User.Read';
const STATE_AUD = 'ms-state';
const STATE_TTL_SEC = 10 * 60;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/** Error con mensaje seguro (en español) para mostrar al usuario tras el callback. */
export class OutlookConnectError extends Error {}

/** Conexión con Outlook / Microsoft Graph, ligada al usuario ya logueado en la app. */
@Injectable()
export class MicrosoftService {
  private readonly logger = new Logger(MicrosoftService.name);
  private cache: { token: string; exp: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: TokenCryptoService,
    private readonly jwt: JwtService,
  ) {}

  private tokenUrl() {
    const tenant = this.config.get<string>('MS_TENANT_ID') || 'common';
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  }

  private authorizeUrl() {
    return this.tokenUrl().replace('/token', '/authorize');
  }

  /** URL de autorización (code + PKCE). El state es un JWT firmado, ligado al usuario y de vida corta. */
  buildConnectUrl(userId: string): string {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    // El verifier viaja cifrado dentro del state: sobrevive reinicios y no queda legible en la URL.
    const state = this.jwt.sign(
      { cv: this.crypto.encrypt(verifier) },
      { subject: userId, audience: STATE_AUD, expiresIn: STATE_TTL_SEC },
    );
    const params = new URLSearchParams({
      client_id: this.config.getOrThrow('MS_CLIENT_ID'),
      response_type: 'code',
      redirect_uri: this.config.getOrThrow('MS_REDIRECT_URI'),
      response_mode: 'query',
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return `${this.authorizeUrl()}?${params}`;
  }

  private readState(state: string | undefined, userId: string): string {
    if (!state) throw new OutlookConnectError('Solicitud no válida');
    let payload: { sub?: string; cv?: string };
    try {
      payload = this.jwt.verify(state, { audience: STATE_AUD });
    } catch {
      throw new OutlookConnectError(
        'La solicitud caducó o no es válida; inténtalo de nuevo',
      );
    }
    if (payload.sub !== userId || !payload.cv) {
      throw new OutlookConnectError('La solicitud no corresponde a tu sesión');
    }
    try {
      return this.crypto.decrypt(payload.cv);
    } catch {
      throw new OutlookConnectError('Solicitud no válida');
    }
  }

  private async tokenRequest(body: Record<string, string>) {
    const params = new URLSearchParams({
      client_id: this.config.getOrThrow('MS_CLIENT_ID'),
      scope: SCOPES,
      ...body,
    });
    const secret = this.config.get<string>('MS_CLIENT_SECRET');
    if (secret) params.set('client_secret', secret);
    const res = await fetch(this.tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    if (!res.ok) {
      // No se registra el cuerpo completo: solo el código de error.
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      this.logger.warn(`Token endpoint ${res.status} ${err.error ?? ''}`);
      throw new OutlookConnectError(
        err.error === 'invalid_grant'
          ? 'La conexión con Outlook caducó; vuelve a conectarla'
          : 'No se pudo autenticar con Microsoft',
      );
    }
    return (await res.json()) as TokenResponse;
  }

  /** Completa la conexión: valida state/PKCE y usuario, guarda el refresh token cifrado. Devuelve el correo. */
  async handleCallback(
    userId: string,
    code: string,
    state: string | undefined,
  ): Promise<string> {
    const verifier = this.readState(state, userId);
    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.getOrThrow('MS_REDIRECT_URI'),
      code_verifier: verifier,
    });
    if (!tokens.refresh_token) {
      throw new OutlookConnectError('Microsoft no entregó el permiso offline');
    }
    const me = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!me.ok) throw new OutlookConnectError('No se pudo leer tu perfil');
    const profile = (await me.json()) as {
      mail?: string;
      userPrincipalName?: string;
    };
    const email = (
      profile.mail ||
      profile.userPrincipalName ||
      ''
    ).toLowerCase();
    if (!email) throw new OutlookConnectError('Tu perfil no tiene correo');

    const tokenEnc = this.crypto.encrypt(tokens.refresh_token);
    const mine = await this.prisma.mailAccount.findUnique({
      where: { userId },
    });
    const byEmail = await this.prisma.mailAccount.findUnique({
      where: { email },
    });
    if (byEmail && byEmail.userId && byEmail.userId !== userId) {
      throw new OutlookConnectError(
        'Ese correo ya está conectado a otro usuario',
      );
    }
    if (mine && mine.email !== email) {
      const threads = await this.prisma.thread.count({
        where: { accountId: mine.id },
      });
      if (threads > 0) {
        throw new OutlookConnectError(
          `Antes usabas ${mine.email}; conecta esa misma cuenta para conservar tus tickets`,
        );
      }
      await this.prisma.mailAccount.update({
        where: { id: mine.id },
        data: { email, tokenEnc },
      });
    } else if (mine) {
      await this.prisma.mailAccount.update({
        where: { id: mine.id },
        data: { tokenEnc },
      });
    } else if (byEmail) {
      // Cuenta huérfana (anterior a la fase 8): se adopta.
      await this.prisma.mailAccount.update({
        where: { id: byEmail.id },
        data: { userId, tokenEnc },
      });
    } else {
      await this.prisma.mailAccount.create({
        data: { email, tokenEnc, userId },
      });
    }
    this.cache = {
      token: tokens.access_token,
      exp: Date.now() + tokens.expires_in * 1000,
    };
    return email;
  }

  /** Access token vigente de la cuenta conectada; renueva con el refresh token (y lo rota si cambia). */
  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cache && this.cache.exp - 60_000 > Date.now()) {
      return this.cache.token;
    }
    const account = await this.prisma.mailAccount.findFirst({
      where: { tokenEnc: { not: null } },
    });
    if (!account?.tokenEnc) {
      throw new OutlookConnectError('No hay cuenta conectada');
    }
    const tokens = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: this.crypto.decrypt(account.tokenEnc),
    });
    if (tokens.refresh_token) {
      await this.prisma.mailAccount.update({
        where: { id: account.id },
        data: { tokenEnc: this.crypto.encrypt(tokens.refresh_token) },
      });
    }
    this.cache = {
      token: tokens.access_token,
      exp: Date.now() + tokens.expires_in * 1000,
    };
    return tokens.access_token;
  }

  /** Cuenta conectada (con tokens) del usuario, o null. */
  async connectedAccount(userId: string) {
    const acc = await this.prisma.mailAccount.findUnique({ where: { userId } });
    return acc?.tokenEnc ? acc : null;
  }

  /** Borra solo los tokens y el estado de sync de Microsoft; conserva hilos, mensajes y síntesis. */
  async disconnect(userId: string) {
    const acc = await this.prisma.mailAccount.findUnique({ where: { userId } });
    if (!acc) return;
    await this.prisma.mailFolderSync.deleteMany({
      where: { accountId: acc.id },
    });
    await this.prisma.mailAccount.update({
      where: { id: acc.id },
      data: { tokenEnc: null, lastSyncAt: null },
    });
    this.cache = null;
  }
}
