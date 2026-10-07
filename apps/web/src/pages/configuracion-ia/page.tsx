import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LuArrowLeft, LuSave } from 'react-icons/lu'
import CredencialesProveedor from '../../components/ia/CredencialesProveedor'
import ModeloPorTarea from '../../components/ia/ModeloPorTarea'
import SelectorProveedor from '../../components/ia/SelectorProveedor'
import ErrorBox from '../../components/ErrorBox'
import Spinner from '../../components/Spinner'
import { useToast } from '../../context/toasts-context'
import { useAjustesIa, useGuardarAjustesIa, useHardware } from '../../hooks/useAjustesIa'
import type { AjustesIa } from '../../lib/api'
import { errorMessage } from '../../lib/format'
import { borradorDesde, cambiosDesde, conProveedor, faltaClave, type BorradorIa } from '../../lib/ia'

function Formulario({ inicial }: { inicial: AjustesIa }) {
  const { toast } = useToast()
  const hw = useHardware()
  const guardar = useGuardarAjustesIa()
  const [ajustes, setAjustes] = useState(inicial)
  const [borrador, setBorrador] = useState<BorradorIa>(() => borradorDesde(inicial))

  const guardarCambios = async () => {
    try {
      const nuevo = await guardar.mutate({ body_params: cambiosDesde(borrador) })
      setAjustes(nuevo)
      setBorrador(borradorDesde(nuevo)) // las claves escritas se descartan: no quedan en pantalla
      toast('Cambios guardados.', 'ok')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-lg font-bold">Proveedor</h3>
        <SelectorProveedor value={borrador.proveedor} hardware={hw.data} onChange={(p) => setBorrador((b) => conProveedor(b, ajustes, p))} />
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-lg font-bold">Conexión</h3>
        <CredencialesProveedor ajustes={ajustes} borrador={borrador} onChange={setBorrador} hardware={hw.data} onRecheck={() => hw.refetch()} />
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-lg font-bold">Modelo por tarea</h3>
        <ModeloPorTarea
          proveedor={borrador.proveedor}
          modelos={borrador.modelos}
          sugeridos={ajustes.sugeridos[borrador.proveedor] ?? { texto: [], vision: [] }}
          onChange={(t, m) => setBorrador((b) => ({ ...b, modelos: { ...b.modelos, [t]: m } }))}
        />
      </section>

      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="min-h-11 cursor-pointer font-bold">Opciones avanzadas</summary>
        <div className="mt-3 space-y-2">
          <label htmlFor="max-tokens" className="block font-semibold">Máximo de tokens por petición (maxInputTokens)</label>
          <input
            id="max-tokens"
            type="number"
            min={2000}
            className="min-h-12 w-full rounded-xl border border-slate-300 px-3"
            value={borrador.maxInputTokens}
            onChange={(e) => setBorrador((b) => ({ ...b, maxInputTokens: Number(e.target.value) }))}
          />
          <p className="text-sm text-slate-700">Si un hilo no cabe, las novedades se envían por tramos. Mínimo 2000.</p>
          {borrador.proveedor === 'ollama' && (
            <>
              <label htmlFor="ollama-url" className="block font-semibold">Dirección de Ollama</label>
              <input id="ollama-url" type="text" className="min-h-12 w-full rounded-xl border border-slate-300 px-3" value={borrador.ollamaUrl} onChange={(e) => setBorrador((b) => ({ ...b, ollamaUrl: e.target.value }))} />
            </>
          )}
        </div>
      </details>

      <button type="button" className="btn w-full text-lg" disabled={guardar.loading || faltaClave(borrador, ajustes)} onClick={() => void guardarCambios()}>
        <LuSave className="size-5" aria-hidden />{guardar.loading ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}

export default function ConfiguracionIa() {
  const { data, error, refetch } = useAjustesIa()
  return (
    <section className="space-y-5">
      <Link to="/ajustes" className="inline-flex min-h-11 items-center gap-1 text-blue-700 underline"><LuArrowLeft className="size-4" aria-hidden />Ajustes</Link>
      <h2 className="text-2xl font-bold">Inteligencia artificial</h2>
      {error && !data && <ErrorBox message={error} onRetry={() => void refetch()} />}
      {!data && !error && <Spinner text="Cargando…" />}
      {data && <Formulario inicial={data} />}
    </section>
  )
}
