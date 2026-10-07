import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** deviceId: aleatorio de >= 128 bits en base64url (va en la URL del QR). */
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{22,64}$/;
/** Secreto del dispositivo: nunca se guarda en claro aquí, solo su SHA-256. */
export const DEVICE_SECRET_RE = /^[A-Za-z0-9_-]{32,128}$/;

export type VerifyResult = 'ok' | 'new' | 'bad';

/** Tope de deviceIds revocados que se recuerdan (cada uno son ~22 bytes). */
const MAX_REVOKED = 100_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest();

/**
 * Registro de dispositivos: deviceId -> SHA-256(secreto) (hex). Decisión (fase 1): "confiar
 * en el primer uso" (el primer secreto que llega para un deviceId inexistente lo registra) y
 * se guarda en un único JSON pequeño (`devices.json`, escritura atómica). El deviceId es
 * aleatorio de 128 bits, así que nadie lo adivina; el tope `maxDevices` y el límite por IP
 * del relay acotan el abuso. Sin `file` vive solo en memoria (tests).
 */
export class DeviceRegistry {
  private readonly hashes = new Map<string, string>();
  /** deviceIds desvinculados: no se pueden volver a registrar (el QR viejo no resucita). */
  private readonly revoked = new Set<string>();

  constructor(
    private readonly file?: string,
    private readonly maxDevices = 5000,
  ) {
    if (file && existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        // Formato nuevo {devices, revoked}; el de la fase 1 era directamente {deviceId: hash}.
        const devices = (parsed.devices && typeof parsed.devices === 'object' ? parsed.devices : parsed) as Record<string, string>;
        for (const [id, h] of Object.entries(devices)) {
          if (DEVICE_ID_RE.test(id) && typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) this.hashes.set(id, h);
        }
        if (Array.isArray(parsed.revoked)) {
          for (const id of parsed.revoked) if (typeof id === 'string' && DEVICE_ID_RE.test(id)) this.revoked.add(id);
        }
      } catch {
        // Archivo dañado: se empieza vacío (los escritorios se vuelven a registrar solos).
      }
    }
  }

  get size() {
    return this.hashes.size;
  }

  /** 'ok' = secreto correcto; 'new' = no existe (se puede registrar); 'bad' = formato o secreto inválido. */
  verify(deviceId: string, secret: string): VerifyResult {
    if (!DEVICE_ID_RE.test(deviceId) || !DEVICE_SECRET_RE.test(secret)) return 'bad';
    if (this.revoked.has(deviceId)) return 'bad';
    const stored = this.hashes.get(deviceId);
    if (!stored) return this.hashes.size >= this.maxDevices ? 'bad' : 'new';
    return timingSafeEqual(Buffer.from(stored, 'hex'), sha256(secret)) ? 'ok' : 'bad';
  }

  register(deviceId: string, secret: string): void {
    this.hashes.set(deviceId, sha256(secret).toString('hex'));
    this.save();
  }

  /** Desvincular: olvida el secreto y recuerda el deviceId como revocado. */
  remove(deviceId: string): void {
    const had = this.hashes.delete(deviceId);
    if (this.revoked.size < MAX_REVOKED && !this.revoked.has(deviceId)) {
      this.revoked.add(deviceId);
      this.save();
    } else if (had) this.save();
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ devices: Object.fromEntries(this.hashes), revoked: [...this.revoked] }), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
