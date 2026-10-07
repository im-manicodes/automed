import { useMutation } from '../../../hooks/useMutation'
import { useQuery } from '../../../hooks/useQuery'

export type EstadoRelay = 'desconectado' | 'conectando' | 'conectado' | 'rechazado'

export interface RelayEstado {
  /** false = no es la app de escritorio. */
  disponible: boolean
  /** false = esta versión no trae la dirección del servicio para el celular. */
  configurado: boolean
  activo: boolean
  estado: EstadoRelay
  /** Dirección para mostrar (sin la clave de cifrado). */
  url?: string
  /** Contenido del QR: dirección + `#k=<clave>`; la clave nunca llega al servicio intermedio. */
  urlQr?: string
  /** Preferencia «mantener la computadora despierta» (solo rige con el celular activo). */
  mantenerDespierto?: boolean
  /** Arranque que sirve el servicio: hash esperado y si el servicio lo muestra igual (lo comprueba la computadora). */
  arranque?: { sha256: string; estado: 'ok' | 'distinto' | 'sin_comprobar' }
}

/** Estado del túnel al celular (GET /relay/status). */
export function useRelayEstado() {
  return useQuery<RelayEstado>({ url: '/relay/status' })
}

/** Activa «Usar desde el celular» (POST /relay/enable). */
export function useActivarRelay() {
  return useMutation<RelayEstado>({ url: '/relay/enable' })
}

/** Desvincula el celular y borra el acceso (POST /relay/disable). */
export function useDesvincularRelay() {
  return useMutation<RelayEstado>({ url: '/relay/disable' })
}

/** Mantener la computadora despierta mientras el celular esté activo (POST /relay/keep-awake). */
export function useMantenerDespierto() {
  return useMutation<RelayEstado, { activo: boolean }>({ url: '/relay/keep-awake' })
}
