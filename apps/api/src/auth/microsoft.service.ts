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

const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTHORITIES = ['common', 'organizations', 'consumers'];

/** Autoridad de login: vacío = `common` (organizaciones + cuentas personales). Acepta common/organizations/consumers o un GUID. */
export function resolveAuthority(raw: string | undefined | null): string {
  const v = (raw ?? '').trim();
  if (!v) return 'common';
  if (AUTHORITIES.includes(v.toLowerCase())) return v.toLowerCase();
  if (GUID_RE.test(v)) return v;
  return 'common';
}

export interface GraphProfile {
  mail?: string | null;
  userPrincipalName?: string | null;
  otherMails?: string[] | null;
}

/**
 * Correo de la cuenta: mail || otherMails[0] || userPrincipalName.
 * Se descartan UPN de invitado (`#EXT#`); en cuentas personales `mail` puede ser null.
 */
export function resolveProfileEmail(profile: GraphProfile): string {
  const upn = profile.userPrincipalName?.trim();
  const candidates = [
    profile.mail,
    profile.otherMails?.find((m) => !!m?.trim()),
    upn && !upn.toUpperCase().includes('#EXT#') ? upn : undefined,
  ];
  const found = candidates.find((c) => !!c?.trim());
  return (found ?? '').trim().toLowerCase();
}

/** Mensaje en español según el código AADSTS / error del endpoint de token. */
export function tokenErrorMessage(
  error?: string,
  description?: string,
): string {
  const code = /AADSTS(\d+)/.exec(description ?? '')?.[1];
  if (error === 'invalid_grant' && code !== '65001') {
    return 'La conexión con Outlook caducó; vuelve a conectarla';
  }
  if (code === '50020') {
    return 'Esa cuenta no está permitida por el registro de la app en Microsoft; revisa el tipo de cuenta compatible o el valor de MS_TENANT_ID';
  }
  if (code === '700016') {
    return 'Microsoft no reconoce la aplicación en ese directorio; revisa MS_CLIENT_ID y el tipo de cuenta del registro';
  }
  if (error === 'consent_required' || code === '65001') {
    return 'Falta el consentimiento: acepta los permisos al conectar, o pide a tu administrador que los apruebe';
  }
  return 'No se pudo autenticar con Microsoft';
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
  ) {
    const authority = resolveAuthority(this.config.get<string>('MS_TENANT_ID'));
    if (GUID_RE.test(authority)) {
      this.logger.warn(
        'MS_TENANT_ID es un GUID: solo se admitirán cuentas de ese inquilino. Usa "common" para organizaciones y cuentas personales.',
      );
    }
  }

  private tokenUrl() {
    const tenant = resolveAuthority(this.config.get<string>('MS_TENANT_ID'));
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
      const err = (await res.json().catch(() => ({}))) as {
        error?: string;
        error_description?: string;
      };
      const aadsts = /AADSTS\d+/.exec(err.error_description ?? '')?.[0] ?? '';
      this.logger.warn(
        `Token endpoint ${res.status} ${err.error ?? ''} ${aadsts}`,
      );
      throw new OutlookConnectError(
        tokenErrorMessage(err.error, err.error_description),
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
      'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,otherMails',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!me.ok) throw new OutlookConnectError('No se pudo leer tu perfil');
    const email = resolveProfileEmail((await me.json()) as GraphProfile);
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
