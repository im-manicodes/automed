import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(data: Buffer): string;
  /** Solo Linux: 'basic_text' = sin almacén de secretos real. */
  getSelectedStorageBackend?(): string;
}

/** Identidad del dispositivo ante el relay («Usar desde el celular»); se crea al activarlo. */
export interface RelaySecrets {
  deviceId: string;
  secret: string;
  /** Clave E2E (32 bytes, base64url): va en el `#` del QR y se guarda aquí; nunca llega al relay. */
  e2eKey: string;
  enabled: boolean;
}

export interface Secrets {
  jwtSecret: string;
  tokenEncKey: string;
  pgPassword: string;
  relay?: RelaySecrets;
}

export interface LoadedSecrets {
  secrets: Secrets;
  /** Aviso en español sencillo (nunca contiene secretos). */
  warning?: string;
  created: boolean;
}

/** Formato de secrets.bin: 1 byte de tipo ('E' cifrado con safeStorage, 'P' texto plano) + carga. */
const ENCRYPTED = 0x45;
const PLAIN = 0x50;

export const WARN_NO_SAFE_STORAGE =
  'Este equipo no tiene un almacén seguro de claves; las claves de la app se guardan en un archivo protegido solo para tu usuario.';

export function generateSecrets(): Secrets {
  return {
    jwtSecret: randomBytes(48).toString('base64'),
    tokenEncKey: randomBytes(32).toString('base64'),
    pgPassword: randomBytes(24).toString('base64url'),
  };
}

function isValid(s: unknown): s is Secrets {
  const o = s as Secrets;
  return (
    !!o &&
    typeof o.jwtSecret === 'string' &&
    o.jwtSecret.length >= 32 &&
    typeof o.tokenEncKey === 'string' &&
    Buffer.from(o.tokenEncKey, 'base64').length === 32 &&
    typeof o.pgPassword === 'string' &&
    o.pgPassword.length >= 16 &&
    (o.relay === undefined ||
      (typeof o.relay.deviceId === 'string' &&
        typeof o.relay.secret === 'string' &&
        (o.relay.e2eKey === undefined || typeof o.relay.e2eKey === 'string') &&
        typeof o.relay.enabled === 'boolean'))
  );
}

function canEncrypt(ss: SafeStorageLike | null): ss is SafeStorageLike {
  if (!ss) return false;
  try {
    if (!ss.isEncryptionAvailable()) return false;
    return ss.getSelectedStorageBackend?.() !== 'basic_text';
  } catch {
    return false;
  }
}

function write(file: string, kind: number, payload: Buffer) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([Buffer.from([kind]), payload]), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows: los permisos POSIX no aplican */
  }
}

/**
 * Lee `<dataDir>/secrets.bin` o lo crea en el primer arranque. Si ya existe y no se puede
 * descifrar NO se regenera (perderíamos el acceso a la base de datos): se lanza un error.
 */
export function loadOrCreateSecrets(
  dataDir: string,
  safeStorage: SafeStorageLike | null,
): LoadedSecrets {
  const file = join(dataDir, 'secrets.bin');
  const secure = canEncrypt(safeStorage);
  if (existsSync(file)) {
    const raw = readFileSync(file);
    const kind = raw[0];
    const body = raw.subarray(1);
    let parsed: unknown;
    try {
      if (kind === ENCRYPTED) {
        if (!safeStorage) throw new Error('sin safeStorage');
        parsed = JSON.parse(safeStorage.decryptString(body));
      } else if (kind === PLAIN) {
        parsed = JSON.parse(body.toString('utf8'));
      } else {
        throw new Error('formato desconocido');
      }
    } catch {
      throw new Error(
        'No se pudieron leer las claves guardadas (secrets.bin). Si cambiaste de usuario del sistema o de equipo, los datos no se pueden abrir.',
      );
    }
    if (!isValid(parsed)) {
      throw new Error('El archivo de claves (secrets.bin) está dañado.');
    }
    // Si antes no había almacén seguro y ahora sí, se migra a cifrado.
    if (kind === PLAIN && secure) {
      write(file, ENCRYPTED, safeStorage.encryptString(JSON.stringify(parsed)));
    }
    return {
      secrets: parsed,
      created: false,
      warning: kind === PLAIN && !secure ? WARN_NO_SAFE_STORAGE : undefined,
    };
  }
  const secrets = generateSecrets();
  const json = JSON.stringify(secrets);
  if (secure) {
    write(file, ENCRYPTED, safeStorage.encryptString(json));
    return { secrets, created: true };
  }
  write(file, PLAIN, Buffer.from(json, 'utf8'));
  return { secrets, created: true, warning: WARN_NO_SAFE_STORAGE };
}

/** Reescribe `secrets.bin` con los secretos dados (p. ej. al activar/desvincular el relay). */
export function saveSecrets(dataDir: string, safeStorage: SafeStorageLike | null, secrets: Secrets): void {
  const file = join(dataDir, 'secrets.bin');
  const json = JSON.stringify(secrets);
  if (canEncrypt(safeStorage)) write(file, ENCRYPTED, safeStorage.encryptString(json));
  else write(file, PLAIN, Buffer.from(json, 'utf8'));
}
