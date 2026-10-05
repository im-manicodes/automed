import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import type { AuthUser } from './auth.types';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  cookieHeader,
  parseDuration,
} from './cookies';

export const MIN_JWT_SECRET_LENGTH = 32;
const ACCESS_AUD = 'access';
const BAD_LOGIN = 'Correo o contraseña incorrectos';

export interface SessionTokens {
  user: AuthUser;
  access: string;
  refresh: string;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** Login de la app (correo + contraseña), JWT de acceso y refresh tokens rotativos. */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  private accessTtl() {
    return this.config.get<string>('JWT_ACCESS_TTL') || '15m';
  }

  accessTtlMs() {
    return parseDuration(this.accessTtl(), '15m');
  }

  refreshTtlMs() {
    return parseDuration(this.config.get<string>('JWT_REFRESH_TTL'), '30d');
  }

  /** Cabeceras Set-Cookie (access en `/`, refresh solo en `/api/auth`). */
  cookies(tokens: { access: string; refresh: string }, secure: boolean) {
    return [
      cookieHeader(ACCESS_COOKIE, tokens.access, {
        secure,
        path: '/',
        maxAgeMs: this.accessTtlMs(),
      }),
      cookieHeader(REFRESH_COOKIE, tokens.refresh, {
        secure,
        path: '/api/auth',
        maxAgeMs: this.refreshTtlMs(),
      }),
    ];
  }

  clearCookies(secure: boolean) {
    return [
      cookieHeader(ACCESS_COOKIE, '', { secure, path: '/', maxAgeMs: 0 }),
      cookieHeader(REFRESH_COOKIE, '', {
        secure,
        path: '/api/auth',
        maxAgeMs: 0,
      }),
    ];
  }

  private signAccess(user: AuthUser): string {
    return this.jwt.sign(
      { email: user.email, nombre: user.nombre },
      {
        subject: user.id,
        audience: ACCESS_AUD,
        expiresIn: Math.floor(this.accessTtlMs() / 1000),
      },
    );
  }

  /** Valida el JWT de acceso (firma, audiencia y expiración). null si no es válido. */
  verifyAccess(token: string | undefined): AuthUser | null {
    if (!token) return null;
    try {
      const p = this.jwt.verify<{
        sub?: string;
        email?: string;
        nombre?: string;
      }>(token, { audience: ACCESS_AUD });
      if (!p.sub || !p.email) return null;
      return { id: p.sub, email: p.email, nombre: p.nombre ?? '' };
    } catch {
      return null;
    }
  }

  private async issueRefresh(
    userId: string,
    familyId: string,
    userAgent?: string,
  ) {
    const raw = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await this.prisma.refreshToken.create({
      data: {
        id,
        userId,
        familyId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + this.refreshTtlMs()),
        userAgent: userAgent?.slice(0, 255),
      },
    });
    return { raw, id };
  }

  private async tokensFor(
    user: AuthUser,
    familyId: string,
    userAgent?: string,
  ): Promise<SessionTokens> {
    const r = await this.issueRefresh(user.id, familyId, userAgent);
    return { user, access: this.signAccess(user), refresh: r.raw };
  }

  async login(
    email: unknown,
    password: unknown,
    userAgent?: string,
  ): Promise<SessionTokens> {
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new UnauthorizedException(BAD_LOGIN);
    }
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    // Siempre se hace una verificación argon2 (con hash falso si no existe): tiempo y mensaje iguales.
    const ok = user
      ? await this.passwords.verify(user.passwordHash, password)
      : await this.passwords.verifyDummy(password);
    if (!user || !ok) throw new UnauthorizedException(BAD_LOGIN);
    await this.prisma.refreshToken.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    });
    return this.tokensFor(
      { id: user.id, email: user.email, nombre: user.nombre },
      randomUUID(),
      userAgent,
    );
  }

  private revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Rota el refresh token. Si se reutiliza uno ya usado/revocado, se revoca toda la familia. */
  async refresh(raw: string | undefined, userAgent?: string) {
    const invalid = new UnauthorizedException('Sesión no válida');
    if (!raw) throw invalid;
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(raw) },
    });
    if (!row) throw invalid;
    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      this.logger.warn('Reutilización de refresh token: familia revocada');
      throw invalid;
    }
    if (row.expiresAt.getTime() <= Date.now()) throw invalid;
    // Reclamo atómico: si dos peticiones usan el mismo token, solo una gana.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(row.familyId);
      throw invalid;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
    });
    if (!user) throw invalid;
    const authUser = { id: user.id, email: user.email, nombre: user.nombre };
    const next = await this.issueRefresh(user.id, row.familyId, userAgent);
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { replacedBy: next.id },
    });
    const tokens: SessionTokens = {
      user: authUser,
      access: this.signAccess(authUser),
      refresh: next.raw,
    };
    return tokens;
  }

  async logout(raw: string | undefined) {
    if (!raw) return;
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(raw) },
    });
    if (row) await this.revokeFamily(row.familyId);
  }

  async changePassword(
    userId: string,
    actual: unknown,
    nueva: unknown,
    currentRefresh?: string,
  ) {
    if (typeof actual !== 'string' || typeof nueva !== 'string') {
      throw new BadRequestException('Faltan datos');
    }
    const policy = this.passwords.policyError(nueva);
    if (policy) throw new BadRequestException(policy);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await this.passwords.verify(user.passwordHash, actual))) {
      throw new UnauthorizedException('La contraseña actual no es correcta');
    }
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.passwords.hash(nueva),
        passwordChangedAt: now,
      },
    });
    // Se conservan solo los tokens de la sesión actual (misma familia); el resto se revoca.
    let keepFamily: string | undefined;
    if (currentRefresh) {
      const cur = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: sha256(currentRefresh) },
      });
      if (cur && cur.userId === userId) keepFamily = cur.familyId;
    }
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(keepFamily ? { familyId: { not: keepFamily } } : {}),
      },
      data: { revokedAt: now },
    });
  }
}
