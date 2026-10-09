import { useCallback } from 'react'
import { useQuery } from './useQuery'
import { useMutation } from './useMutation'
import { useGuardarAjustesIa } from './useAjustesIa'
import { usePolling } from './usePolling'
import type {
  AjustesIa,
  AjustesOcr,
  CambiosAjustesOcr,
  MotorOcr,
  OcrLocal,
  PruebaOcrResultado,
} from '../lib/api'
import { cambiosAws, type AvanzadoOcr, type ClavesAws } from '../lib/ocr'

type Callbacks<T> = { onSuccess?: (data: T) => void; onError?: (message: string) => void }

export function useAjustesOcr(cb: Callbacks<AjustesOcr> & { enabled?: boolean } = {}) {
  return useQuery<AjustesOcr>({ url: '/settings/ocr', ...cb })
}

export function useGuardarAjustesOcr(cb: Callbacks<AjustesOcr> = {}) {
  return useMutation<AjustesOcr, CambiosAjustesOcr>({ url: '/settings/ocr', method: 'PUT', ...cb })
}

export function usePruebaOcr() {
  return useMutation<PruebaOcrResultado>({ url: '/settings/ocr/probar' })
}

/** Cada cuánto se consulta el avance mientras se instala o arranca el OCR local. */
export const INTERVALO_OCR_LOCAL_MS = 2000

/** ¿El OCR local está cambiando (instalación o arranque) y conviene seguir consultando? */
export const ocrLocalOcupado = (o: OcrLocal | null) =>
  !!o && (o.estado === 'instalando' || o.estado === 'descargando-modelos' || o.proceso === 'iniciando')

/** Estado del OCR local gestionado por la app; consulta cada 2 s mientras instala o arranca. */
export function useOcrLocal(cb: Callbacks<OcrLocal> & { enabled?: boolean } = {}) {
  const query = useQuery<OcrLocal>({ url: '/settings/ocr/local', ...cb })
  const { refetch } = query
  usePolling(() => void refetch(), INTERVALO_OCR_LOCAL_MS, ocrLocalOcupado(query.data))
  return query
}

export function useInstalarOcrLocal(cb: Callbacks<OcrLocal> = {}) {
  return useMutation<OcrLocal>({ url: '/settings/ocr/local/instalar', ...cb })
}

export function useIniciarOcrLocal(cb: Callbacks<OcrLocal> = {}) {
  return useMutation<OcrLocal>({ url: '/settings/ocr/local/iniciar', ...cb })
}

export function useDetenerOcrLocal(cb: Callbacks<OcrLocal> = {}) {
  return useMutation<OcrLocal>({ url: '/settings/ocr/local/detener', ...cb })
}

export function useDesinstalarOcrLocal(cb: Callbacks<OcrLocal> = {}) {
  return useMutation<OcrLocal>({ url: '/settings/ocr/local', method: 'DELETE', ...cb })
}

/**
 * Aplica la lectura de PDFs: primero las claves de AWS nuevas (PUT /settings/ia, solo con Textract)
 * y luego el motor (PUT /settings/ocr; omitido si no cambió, salvo `forzar`).
 */
export function useAplicarOcr() {
  const ocr = useGuardarAjustesOcr()
  const ia = useGuardarAjustesIa()
  const { mutate: guardarOcr } = ocr
  const { mutate: guardarIa } = ia
  const aplicar = useCallback(
    async (o: { motor: MotorOcr; actual: AjustesOcr; claves: ClavesAws; forzar?: boolean; avanzado?: AvanzadoOcr }) => {
      let nuevoIa: AjustesIa | null = null
      let nuevoOcr: AjustesOcr | null = null
      const cambios = o.motor === 'textract' ? cambiosAws(o.claves) : null
      if (cambios) nuevoIa = await guardarIa({ body_params: cambios })
      const avanzado = o.avanzado
      const avanzadoCambio = !!avanzado && (Object.keys(avanzado) as (keyof AvanzadoOcr)[]).some((k) => avanzado[k] !== o.actual[k])
      if (o.forzar || avanzadoCambio || o.motor !== o.actual.motor) {
        nuevoOcr = await guardarOcr({ body_params: { motor: o.motor, ...(avanzado ?? {}) } })
      }
      return { ocr: nuevoOcr, ia: nuevoIa }
    },
    [guardarIa, guardarOcr],
  )
  return { aplicar, loading: ocr.loading || ia.loading }
}
