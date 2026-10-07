import {
  BadRequestException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type EstadoRelay =
  'desconectado' | 'conectando' | 'conectado' | 'rechazado';

export interface RelayStatus {
  /** false = no es la app de escritorio (no hay con qué controlar el túnel). */
  disponible: boolean;
  /** false = la app no trae la dirección del relay (compilación o variable sin definir). */
  configurado: boolean;
  activo: boolean;
  estado: EstadoRelay;
  /** Dirección para mostrar: https://<relay>/d/<deviceId> (sin la clave). Solo con el relay activo. */
  url?: string;
  /** Contenido del QR: la dirección + `#k=<clave E2E>` (el fragmento nunca llega al relay). */
  urlQr?: string;
  /** Preferencia «mantener la computadora despierta» (solo rige con el túnel activo). */
  mantenerDespierto?: boolean;
  /** Arranque que sirve el relay: hash esperado y si el relay lo sirve igual (comprobado por el escritorio). */
  arranque?: { sha256: string; estado: 'ok' | 'distinto' | 'sin_comprobar' };
}

/**
 * Puente hacia el cliente del túnel que vive en el proceso principal de Electron
 * (`apps/desktop/src/relay-control.ts`): 127.0.0.1 + token aleatorio por arranque.
 * Fuera del escritorio no hay control y el estado es "no disponible".
 */
@Injectable()
export class RelayService {
  constructor(private readonly config: ConfigService) {}

  private get control(): { url: string; token: string } | null {
    const url = this.config.get<string>('RELAY_CONTROL_URL');
    const token = this.config.get<string>('RELAY_CONTROL_TOKEN');
    return url && token ? { url, token } : null;
  }

  status(): Promise<RelayStatus> {
    return this.call('GET', '/status');
  }

  enable(): Promise<RelayStatus> {
    return this.call('POST', '/enable');
  }

  disable(): Promise<RelayStatus> {
    return this.call('POST', '/disable');
  }

  keepAwake(activo: unknown): Promise<RelayStatus> {
    if (typeof activo !== 'boolean') {
      throw new BadRequestException('Dato inválido.');
    }
    return this.call('POST', '/keep-awake', { activo });
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<RelayStatus> {
    const c = this.control;
    if (!c) {
      return {
        disponible: false,
        configurado: false,
        activo: false,
        estado: 'desconectado',
        mantenerDespierto: false,
      };
    }
    let res: Response;
    try {
      res = await fetch(`${c.url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${c.token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo hablar con la app de escritorio. Intenta de nuevo.',
      );
    }
    if (!res.ok) {
      throw new HttpException(
        'No se pudo completar la acción.',
        res.status === 400 ? 400 : 502,
      );
    }
    return {
      disponible: true,
      ...((await res.json()) as Omit<RelayStatus, 'disponible'>),
    };
  }
}
