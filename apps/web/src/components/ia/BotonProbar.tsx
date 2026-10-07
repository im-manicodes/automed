import { useState } from 'react'
import { LuCheck, LuTriangleAlert, LuZap } from 'react-icons/lu'
import { usePruebaIa } from '../../hooks/useAjustesIa'
import type { PruebaIaBorrador, PruebaIaResultado } from '../../lib/api'
import { errorMessage } from '../../lib/format'

/** Prueba la conexión con el borrador actual y muestra el resultado. */
export default function BotonProbar({ borrador }: { borrador: PruebaIaBorrador }) {
  const { mutate, loading } = usePruebaIa()
  const [res, setRes] = useState<PruebaIaResultado | null>(null)

  const probar = async () => {
    setRes(null)
    try {
      setRes(await mutate({ body_params: borrador }))
    } catch (e) {
      setRes({ ok: false, ms: 0, mensaje: errorMessage(e) })
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void probar()}>
        <LuZap className="size-5" aria-hidden />{loading ? 'Probando…' : 'Probar'}
      </button>
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
