import { useCallback } from 'react'
import { useQuery } from '../../../hooks/useQuery'
import { useMutation } from '../../../hooks/useMutation'
import type { Reporte, ReporteAjustes, ReporteDetalle } from '../../../lib/api'

type Callbacks<T> = { onSuccess?: (data: T) => void; onError?: (message: string) => void }
export type CambiosAjustes = Partial<Pick<ReporteAjustes, 'programado' | 'hora'>>

/** Historial de reportes. Sin carga automática: se pide con `refetch()` (devuelve la lista o null si falló). */
export function useListaReportes(cb: Callbacks<{ reportes: Reporte[] }> = {}) {
  return useQuery<{ reportes: Reporte[] }>({ url: '/reports', enabled: false, ...cb })
}

/** Detalle de un reporte. Sin carga automática: `refetch('/reports/<id>')` vía `consultar(id)`. */
export function useDetalleReporte(cb: Callbacks<ReporteDetalle> = {}) {
  const q = useQuery<ReporteDetalle>({ url: '/reports', enabled: false, ...cb })
  const { refetch } = q
  const consultar = useCallback((id: string) => refetch(`/reports/${encodeURIComponent(id)}`), [refetch])
  return { ...q, consultar }
}

export function useCrearReporte() {
  return useMutation<{ reporte: Reporte; reutilizado: boolean }>({ url: '/reports' })
}

/** Descarga el Excel (blob): `mutate({ urlParams: '/<id>/download' })` vía `descargar(id)`. */
export function useDescargarReporte() {
  const m = useMutation<Blob>({ url: '/reports', method: 'GET', responseType: 'blob' })
  const { mutate } = m
  const descargar = useCallback((id: string) => mutate({ urlParams: `/${encodeURIComponent(id)}/download` }), [mutate])
  return { ...m, descargar }
}

export function useAjustesReporte(cb: Callbacks<ReporteAjustes> = {}) {
  return useQuery<ReporteAjustes>({ url: '/reports/settings', ...cb })
}

export function useGuardarAjustesReporte(cb: Callbacks<ReporteAjustes> = {}) {
  return useMutation<ReporteAjustes, CambiosAjustes>({ url: '/reports/settings', method: 'PUT', ...cb })
}
