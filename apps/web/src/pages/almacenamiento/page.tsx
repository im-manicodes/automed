import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LuArrowLeft, LuSave } from 'react-icons/lu'
import ConfigAlmacenamiento from '../../components/almacenamiento/ConfigAlmacenamiento'
import ErrorBox from '../../components/ErrorBox'
import Spinner from '../../components/Spinner'
import { useToast } from '../../context/toasts-context'
import { useAjustesAlmacenamiento, useGuardarAlmacenamiento } from '../../hooks/useAjustesAlmacenamiento'
import type { AjustesAlmacenamiento } from '../../lib/api'
import { borradorAlmacenamientoDesde, cuerpoAlmacenamiento, faltaAlmacenamiento, type BorradorAlmacenamiento } from '../../lib/almacenamiento'
import { errorMessage } from '../../lib/format'

function Formulario({ inicial }: { inicial: AjustesAlmacenamiento }) {
  const { toast } = useToast()
  const guardar = useGuardarAlmacenamiento()
  const [ajustes, setAjustes] = useState(inicial)
  const [borrador, setBorrador] = useState<BorradorAlmacenamiento>(() => borradorAlmacenamientoDesde(inicial))

  const guardarCambios = async () => {
    try {
      const nuevo = await guardar.mutate({ body_params: cuerpoAlmacenamiento(borrador) })
      setAjustes(nuevo)
      setBorrador(borradorAlmacenamientoDesde(nuevo)) // los secretos escritos se descartan
      toast('Almacenamiento guardado.', 'ok')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <ConfigAlmacenamiento ajustes={ajustes} borrador={borrador} onChange={setBorrador} />
      </section>
      <button type="button" className="btn w-full text-lg" disabled={guardar.loading || faltaAlmacenamiento(borrador, ajustes) !== null} onClick={() => void guardarCambios()}>
        <LuSave className="size-5" aria-hidden />{guardar.loading ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}

export default function Almacenamiento() {
  const { data, error, refetch } = useAjustesAlmacenamiento()
  return (
    <section className="space-y-5">
      <Link to="/ajustes" className="inline-flex min-h-11 items-center gap-1 text-blue-700 underline"><LuArrowLeft className="size-4" aria-hidden />Ajustes</Link>
      <h2 className="text-2xl font-bold">Almacenamiento</h2>
      <p className="text-slate-700">Elige dónde se guardan tus PDFs, las imágenes de sus páginas y los reportes.</p>
      {error && !data && <ErrorBox message={error} onRetry={() => void refetch()} />}
      {!data && !error && <Spinner text="Cargando…" />}
      {data && <Formulario inicial={data} />}
    </section>
  )
}
