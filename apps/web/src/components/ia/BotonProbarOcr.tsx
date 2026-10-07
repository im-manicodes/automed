import { useState } from 'react'
import { LuCheck, LuTriangleAlert, LuZap } from 'react-icons/lu'
import { usePruebaOcr } from '../../hooks/useAjustesOcr'
import type { PruebaOcrResultado } from '../../lib/api'
import { errorMessage } from '../../lib/format'

interface Props {
  /** Se ejecuta antes de probar (guarda las claves escritas, porque la prueba usa las guardadas). */
  antes?: () => Promise<unknown>
  disabled?: boolean
}

export default function BotonProbarOcr({ antes, disabled }: Props) {
  const { mutate, loading } = usePruebaOcr()
  const [res, setRes] = useState<PruebaOcrResultado | null>(null)
  const [preparando, setPreparando] = useState(false)

  const probar = async () => {
    setRes(null)
    setPreparando(true)
    try {
      await antes?.()
      setRes(await mutate())
    } catch (e) {
      setRes({ ok: false, ms: 0, mensaje: errorMessage(e) })
    } finally {
      setPreparando(false)
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" className="btn btn-secondary" disabled={disabled || loading || preparando} onClick={() => void probar()}>
        <LuZap className="size-5" aria-hidden />{loading || preparando ? 'Probando…' : 'Probar Textract'}
      </button>
      <p className="text-sm text-slate-700">Para probar, primero se guardan las claves que escribiste.</p>
      <div aria-live="polite">
        {res && (res.ok ? (
          <p role="status" className="text-green-900"><LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Funciona ({res.ms} ms)</p>
        ) : (
          <p role="alert" className="text-red-900"><LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />{res.mensaje}</p>
        ))}
      </div>
    </div>
  )
}
