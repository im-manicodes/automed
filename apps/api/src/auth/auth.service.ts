import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TokenCryptoService } from './token-crypto.service';
import { SessionService } from './session.service';

const SCOPES = 'offline_access Mail.Read User.Read';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private cache: { token: string; exp: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: TokenCryptoService,
    private readonly sessions: SessionService,
  ) {}

  private tokenUrl() {
    const tenant = this.config.get<string>('MS_TENANT_ID') || 'common';
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  }

  private authorizeUrl() {
    return this.tokenUrl().replace('/token', '/authorize');
  }

  buildLoginUrl(): string {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = this.sessions.savePending(verifier);
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
      throw new UnauthorizedException(
        err.error === 'invalid_grant'
          ? 'La sesión de Microsoft caducó; vuelve a iniciar sesión'
          : 'No se pudo autenticar con Microsoft',
      );
    }
    return (await res.json()) as TokenResponse;
  }

  /** Completa el login: valida state/PKCE, guarda refresh token cifrado, devuelve el email. */
  async handleCallback(code: string, state: string): Promise<string> {
    const verifier = this.sessions.takePending(state);
    if (!verifier) throw new UnauthorizedException('Estado de login inválido');
    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.getOrThrow('MS_REDIRECT_URI'),
      code_verifier: verifier,
    });
    if (!tokens.refresh_token) {
      throw new UnauthorizedException('Microsoft no entregó refresh token');
    }
    const me = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!me.ok) throw new UnauthorizedException('No se pudo leer el perfil');
    const profile = (await me.json()) as {
      mail?: string;
      userPrincipalName?: string;
    };
    const email = (
      profile.mail ||
      profile.userPrincipalName ||
      ''
    ).toLowerCase();
    if (!email) throw new UnauthorizedException('Perfil sin correo');

    const allowed = this.config.get<string>('ALLOWED_EMAIL')?.toLowerCase();
    const existing = await this.prisma.mailAccount.findFirst();
    if (
      (allowed && allowed !== email) ||
      (existing && existing.email !== email)
    ) {
      throw new UnauthorizedException('Esta cuenta no está autorizada');
    }
    const tokenEnc = this.crypto.encrypt(tokens.refresh_token);
    await this.prisma.mailAccount.upsert({
      where: { email },
      create: { email, tokenEnc },
      update: { tokenEnc },
    });
    this.cache = {
      token: tokens.access_token,
      exp: Date.now() + tokens.expires_in * 1000,
    };
    return email;
  }

  /** Access token vigente; renueva con el refresh token (y lo rota si Microsoft entrega uno nuevo). */
  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cache && this.cache.exp - 60_000 > Date.now()) {
      return this.cache.token;
    }
    const account = await this.prisma.mailAccount.findFirst();
    if (!account?.tokenEnc) {
      throw new UnauthorizedException('No hay cuenta conectada');
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

  async connectedEmail(): Promise<string | null> {
    return (await this.prisma.mailAccount.findFirst())?.email ?? null;
  }
}
