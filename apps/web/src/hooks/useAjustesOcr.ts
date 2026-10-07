import { useCallback } from 'react'
import { useQuery } from './useQuery'
import { useMutation } from './useMutation'
import { useGuardarAjustesIa } from './useAjustesIa'
import type {
  AjustesIa,
  AjustesOcr,
  CambiosAjustesOcr,
  MotorOcr,
  PruebaOcrResultado,
} from '../lib/api'
import { cambiosAws, type ClavesAws } from '../lib/ocr'

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
    async (o: { motor: MotorOcr; actual: AjustesOcr; claves: ClavesAws; forzar?: boolean }) => {
      let nuevoIa: AjustesIa | null = null
      let nuevoOcr: AjustesOcr | null = null
      const cambios = o.motor === 'textract' ? cambiosAws(o.claves) : null
      if (cambios) nuevoIa = await guardarIa({ body_params: cambios })
      if (o.forzar || o.motor !== o.actual.motor) nuevoOcr = await guardarOcr({ body_params: { motor: o.motor } })
      return { ocr: nuevoOcr, ia: nuevoIa }
    },
    [guardarIa, guardarOcr],
  )
  return { aplicar, loading: ocr.loading || ia.loading }
}
