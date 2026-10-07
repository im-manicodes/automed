import { randomBytes } from 'node:crypto';
import { generateE2eKey, isValidE2eKey } from './e2e-crypto';
import { BOOTSTRAP_SHA256 } from './bootstrap-hashes';
import type { FrontBundle } from './front-bundle';
import type { KeepAwake } from './keep-awake';
import { checkRelayBootstrap } from './relay-integrity';
import type { EstadoArranque } from './relay-integrity';
import { RelayClient } from './relay-client';
import type { RelayClientOptions, RelayState } from './relay-client';
import type { Secrets } from './secrets';

export interface RelayStatus {
  configurado: boolean;
  activo: boolean;
  estado: RelayState;
  /** Dirección para mostrar: <relay>/d/<deviceId> (sin la clave). Solo con el relay activo. */
  url?: string;
  /** Contenido del QR: la dirección + `#k=<clave E2E>` (el fragmento nunca llega al relay). */
  urlQr?: string;
  /** Preferencia «mantener la computadora despierta» (se aplica solo con el túnel activo). */
  mantenerDespierto: boolean;
  /** Arranque que sirve el relay: hash esperado (publicado en docs/relay-e2e.md) y si el relay lo sirve igual. */
  arranque: { sha256: string; estado: EstadoArranque };
}

export interface RelayManagerOptions {
  /** Front de apps/web que se entrega al celular por el canal cifrado. */
  front?: FrontBundle;
  /** Comprobación del arranque del relay (inyectable en pruebas). */
  checkBootstrap?: (relayUrl: string, deviceId: string) => Promise<EstadoArranque>;
  /** Cada cuánto se repite la comprobación mientras el túnel está activo (ms, por defecto 6 h). */
  checkEveryMs?: number;
  /** powerSaveBlocker del escritorio; sin él la preferencia no se ofrece (siempre false). */
  keepAwake?: KeepAwake;
  /** Dirección del relay (env AUTOMED_RELAY_URL o `relayUrl` de build-config.json); vacía = sin función. */
  relayUrl?: string;
  /** Los secretos vivos del escritorio (se les añade/quita `relay`). */
  secrets: Secrets;
  /** Guarda `secrets.bin` (safeStorage). */
  persist: (s: Secrets) => void;
  /** Token para registrar deviceIds nuevos en el relay (env AUTOMED_RELAY_REGISTRATION_TOKEN o build-config.json). */
  registrationToken?: string;
  /** Token compartido con la API para reenviar la IP real del celular (solo para el límite de login). */
  ipToken?: string;
  log?: (line: string) => void;
  backoff?: RelayClientOptions['backoff'];
}

export class RelayConfigError extends Error {}

export function generateIdentity() {
  return {
    deviceId: randomBytes(16).toString('base64url'),
    secret: randomBytes(32).toString('base64url'),
    e2eKey: generateE2eKey(),
  };
}

/** Activa / desvincula el túnel y guarda la identidad del dispositivo (primer uso: se genera). */
export class RelayManager {
  private client: RelayClient | null = null;
  private port: number | null = null;
  private readonly relayUrl: string | null;
  private arranque: EstadoArranque = 'sin_comprobar';
  private checkTimer: NodeJS.Timeout | null = null;

  constructor(private readonly o: RelayManagerOptions) {
    this.relayUrl = normalizeRelayUrl(o.relayUrl);
  }

  /** Puerto de la API local (null = caída/arrancando). */
  setPort(port: number | null) {
    this.port = port;
  }

  /** Al arrancar la app: si el usuario lo había activado, reconecta. */
  resume() {
    const r = this.o.secrets.relay;
    if (!r?.enabled || this.client) return;
    if (!isValidE2eKey(r.e2eKey)) {
      // Identidad de la fase 1 (sin cifrado): se reemplaza; hay que escanear un QR nuevo.
      this.o.secrets.relay = { ...generateIdentity(), enabled: true };
      this.o.persist(this.o.secrets);
    }
    this.startClient();
  }

  stop() {
    this.stopChecks();
    this.client?.stop();
    this.client = null;
    this.o.keepAwake?.sync(false);
  }

  /** Cambia la preferencia (persistida); el bloqueo solo rige mientras el túnel esté activo. */
  setKeepAwake(v: boolean): RelayStatus {
    this.o.keepAwake?.setPreferencia(v, this.status().activo);
    return this.status();
  }

  status(): RelayStatus {
    const r = this.o.secrets.relay;
    const activo = !!this.relayUrl && !!r?.enabled;
    const url = activo && r && this.relayUrl ? `${this.relayUrl}/d/${r.deviceId}` : undefined;
    return {
      configurado: !!this.relayUrl,
      activo,
      estado: activo ? (this.client?.state ?? 'desconectado') : 'desconectado',
      url,
      urlQr: url && r ? `${url}#k=${r.e2eKey}` : undefined,
      mantenerDespierto: this.o.keepAwake?.preferencia ?? false,
      arranque: { sha256: BOOTSTRAP_SHA256.combined, estado: activo ? this.arranque : 'sin_comprobar' },
    };
  }

  enable(): RelayStatus {
    if (!this.relayUrl) {
      throw new RelayConfigError('Esta versión de la app no trae la dirección del servicio para el celular.');
    }
    const secrets = this.o.secrets;
    // Identidades de la fase 1 (sin clave E2E) se regeneran completas: ese deviceId pudo circular en claro.
    const previous = secrets.relay && isValidE2eKey(secrets.relay.e2eKey) ? secrets.relay : undefined;
    secrets.relay = { ...(previous ?? generateIdentity()), enabled: true };
    this.o.persist(secrets);
    this.startClient();
    return this.status();
  }

  /**
   * Desvincular: el relay olvida el dispositivo (y recuerda el deviceId como revocado), se borra la
   * identidad completa (deviceId, secreto Y clave E2E): el QR viejo ya no sirve ni descifra nada.
   */
  async disable(): Promise<RelayStatus> {
    this.stopChecks();
    await this.client?.unregister();
    this.client = null;
    delete this.o.secrets.relay;
    this.o.persist(this.o.secrets);
    this.o.keepAwake?.sync(false);
    return this.status();
  }

  private startClient() {
    const r = this.o.secrets.relay;
    if (!r || !this.relayUrl) return;
    this.client?.stop();
    this.client = new RelayClient({
      relayUrl: this.relayUrl,
      deviceId: r.deviceId,
      secret: r.secret,
      e2eKey: r.e2eKey,
      registrationToken: this.o.registrationToken,
      ipToken: this.o.ipToken,
      front: this.o.front,
      getPort: () => this.port,
      log: this.o.log,
      backoff: this.o.backoff,
    });
    this.client.start();
    this.o.keepAwake?.sync(true);
    this.startChecks(this.relayUrl, r.deviceId);
  }

  /** Comprueba ya y luego cada `checkEveryMs` que el relay sirve el arranque esperado. */
  private startChecks(relayUrl: string, deviceId: string) {
    this.stopChecks();
    const check = this.o.checkBootstrap ?? ((u, d) => checkRelayBootstrap(u, d));
    const run = () => {
      void check(relayUrl, deviceId).then((e) => {
        if (e === 'distinto' && this.arranque !== 'distinto') this.o.log?.('relay: el arranque que sirve no coincide con el esperado');
        this.arranque = e;
      });
    };
    run();
    this.checkTimer = setInterval(run, this.o.checkEveryMs ?? 6 * 3600_000);
    this.checkTimer.unref();
  }

  private stopChecks() {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
    this.arranque = 'sin_comprobar';
  }
}

/** Devuelve el origen http(s) sin barra final, o null si está vacío/inválido. */
export function normalizeRelayUrl(raw?: string): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}
