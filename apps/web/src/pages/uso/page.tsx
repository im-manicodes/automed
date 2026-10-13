import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LuArrowLeft } from 'react-icons/lu'
import ErrorBox from '../../components/ErrorBox'
import Spinner from '../../components/Spinner'
import { useToast } from '../../context/toasts-context'
import { errorMessage } from '../../lib/format'
import type { CambiosPrecios, PeriodoUso } from '../../lib/api'
import EditorPrecios from './components/EditorPrecios'
import GraficoDias from './components/GraficoDias'
import TablaModelos from './components/TablaModelos'
import TarjetasUso from './components/TarjetasUso'
import { useGuardarPrecios, usePrecios, usePronostico, useUso } from './hooks/useUso'
import { useAjustesIa } from '../../hooks/useAjustesIa'
import { PERIODOS, soloModelosLlm } from './lib/uso'

export default function Uso() {
  const { toast } = useToast()
  const [periodo, setPeriodo] = useState<PeriodoUso>('7d')
  const uso = useUso(periodo)
  const pronostico = usePronostico(7)
  const precios = usePrecios()
  const guardar = useGuardarPrecios()
  const ajustesIa = useAjustesIa()

  const modelosTexto = soloModelosLlm(
    (uso.data?.porModelo ?? []).filter((f) => f.kind === 'llm').map((f) => f.model),
    Object.values(ajustesIa.data?.modelos ?? {}),
  )
  const sinPrecioLlm = soloModelosLlm(uso.data?.modelosSinPrecio)

  const onGuardar = async (cambios: CambiosPrecios) => {
    try {
      await guardar.mutate({ body_params: cambios })
      await Promise.all([precios.refetch(), uso.refetch(), pronostico.refetch()])
      toast('Precios guardados.', 'ok')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <section className="space-y-5">
      <Link to="/ajustes" className="inline-flex min-h-11 items-center gap-1 text-blue-700 underline"><LuArrowLeft className="size-4" aria-hidden />Ajustes</Link>
      <h2 className="text-2xl font-bold">Uso y costo</h2>
      <p className="text-slate-700">Cuánto usan los modelos de IA y cuánto cuesta, según los precios que tú captures. Es una estimación: no sustituye la factura de tu proveedor.</p>

      <div role="radiogroup" aria-label="Periodo" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PERIODOS.map((p) => (
          <button key={p.valor} type="button" role="radio" aria-checked={periodo === p.valor} onClick={() => setPeriodo(p.valor)} className={`btn ${periodo === p.valor ? 'btn-primary' : 'btn-secondary'}`}>
            {p.etiqueta}
          </button>
        ))}
      </div>

      {uso.error && !uso.data && <ErrorBox message={uso.error} onRetry={() => void uso.refetch()} />}
      {uso.loading && !uso.data && <Spinner text="Cargando…" />}
      {uso.data && (
        <>
          {sinPrecioLlm.length > 0 && (
            <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
              Sin precio: {sinPrecioLlm.join(', ')}. No se suman al costo hasta que les pongas precio abajo.
            </p>
          )}
          <TarjetasUso uso={uso.data} pronostico={pronostico.data} />
          <h3 className="text-lg font-bold">Por modelo y actividad</h3>
          <TablaModelos filas={uso.data.porModelo} />
          <h3 className="text-lg font-bold">Costo por día</h3>
          <GraficoDias dias={uso.data.porDia} />
        </>
      )}

      <h3 className="text-lg font-bold">Precios por millón de tokens</h3>
      {precios.error && !precios.data && <ErrorBox message={precios.error} onRetry={() => void precios.refetch()} />}
      {precios.loading && !precios.data && <Spinner text="Cargando…" />}
      {precios.data && (
        <EditorPrecios
          key={JSON.stringify(precios.data)}
          precios={precios.data}
          modelos={modelosTexto}
          sinPrecio={sinPrecioLlm}
          ocrSinPrecio={uso.data?.ocrSinPrecio ?? []}
          guardando={guardar.loading}
          onGuardar={(c) => void onGuardar(c)}
        />
      )}
    </section>
  )
}
