import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const SESSION_COOKIE = 'am_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;

export interface SessionData {
  email: string;
  exp: number;
}

/** Sesión de un solo usuario: cookie firmada (HMAC) + estado PKCE en memoria. */
@Injectable()
export class SessionService {
  private readonly pending = new Map<
    string,
    { verifier: string; exp: number }
  >();

  constructor(private readonly config: ConfigService) {}

  private secret(): Buffer {
    const raw =
      this.config.get<string>('SESSION_SECRET') ||
      this.config.get<string>('TOKEN_ENC_KEY') ||
      '';
    if (!raw) throw new Error('Falta SESSION_SECRET o TOKEN_ENC_KEY');
    return createHmac('sha256', Buffer.from(raw)).update('session-v1').digest();
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret()).update(body).digest('base64url');
  }

  create(email: string, now = Date.now()): string {
    const body = Buffer.from(
      JSON.stringify({ email, exp: now + SESSION_TTL_MS }),
    ).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  verify(token: string | undefined, now = Date.now()): SessionData | null {
    if (!token) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return null;
    }
    try {
      const data = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as SessionData;
      return data.exp > now ? data : null;
    } catch {
      return null;
    }
  }

  parseCookie(header: string | undefined, name = SESSION_COOKIE) {
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return v.join('=');
    }
    return undefined;
  }

  cookieHeader(value: string, secure: boolean, clear = false): string {
    const maxAge = clear ? 0 : Math.floor(SESSION_TTL_MS / 1000);
    return `${SESSION_COOKIE}=${clear ? '' : value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }

  savePending(verifier: string): string {
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.exp < now) this.pending.delete(k);
    const state = randomBytes(16).toString('base64url');
    this.pending.set(state, { verifier, exp: now + PENDING_TTL_MS });
    return state;
  }

  takePending(state: string | undefined): string | null {
    if (!state) return null;
    const p = this.pending.get(state);
    this.pending.delete(state);
    return p && p.exp > Date.now() ? p.verifier : null;
  }
}
