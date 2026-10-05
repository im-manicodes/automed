import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';

export const MIN_PASSWORD_LENGTH = 10;

// argon2id (Algorithm.Argon2id = 2); parámetros mínimos recomendados por OWASP.
const OPTS = {
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Hash y verificación de contraseñas con argon2id (binarios precompilados, sin compilar en Docker). */
@Injectable()
export class PasswordService {
  private dummy: Promise<string> | null = null;

  hash(plain: string): Promise<string> {
    return hash(plain, OPTS);
  }

  /** Devuelve un mensaje de error en español si la contraseña no cumple la política, o null. */
  policyError(plain: string): string | null {
    if (typeof plain !== 'string' || plain.length < MIN_PASSWORD_LENGTH) {
      return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`;
    }
    if (plain.length > 256) return 'La contraseña es demasiado larga';
    return null;
  }

  async verify(storedHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(storedHash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Anti-enumeración: cuando el usuario no existe se verifica contra un hash falso con los
   * mismos parámetros, para que el tiempo de respuesta sea parecido. Siempre devuelve false.
   */
  async verifyDummy(plain: string): Promise<false> {
    this.dummy ??= hash('contraseña-falsa-anti-enumeracion', OPTS);
    await this.verify(await this.dummy, plain);
    return false;
  }
}
