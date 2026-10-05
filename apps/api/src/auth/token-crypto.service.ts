import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** AES-256-GCM. Formato: `v1.<iv>.<tag>.<ciphertext>` (base64url). */
@Injectable()
export class TokenCryptoService {
  constructor(private readonly config: ConfigService) {}

  private key(): Buffer {
    const raw = this.config.get<string>('TOKEN_ENC_KEY');
    const key = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
    if (key.length !== 32) {
      throw new Error(
        'TOKEN_ENC_KEY debe ser 32 bytes en base64 (openssl rand -base64 32)',
      );
    }
    return key;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv, tag, ct]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, ct] = payload.split('.');
    if (version !== 'v1' || !iv || !tag || ct === undefined) {
      throw new Error('Formato de token cifrado inválido');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key(),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
