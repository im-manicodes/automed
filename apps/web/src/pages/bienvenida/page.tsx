import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuArrowLeft, LuArrowRight, LuCheck, LuShieldCheck } from 'react-icons/lu'
import CredencialesProveedor from '../../components/ia/CredencialesProveedor'
import ModeloPorTarea from '../../components/ia/ModeloPorTarea'
import SelectorProveedor from '../../components/ia/SelectorProveedor'
import ErrorBox from '../../components/ErrorBox'
import Spinner from '../../components/Spinner'
import { useBienvenidaCtx } from '../../components/guarda-bienvenida-context'
import { useToast } from '../../context/toasts-context'
import { useAjustesIa, useGuardarAjustesIa, useHardware } from '../../hooks/useAjustesIa'
import type { AjustesIa } from '../../lib/api'
import { errorMessage } from '../../lib/format'
import { borradorDesde, cambiosDesde, conProveedor, faltaClave, nombreProveedor, TAREAS, type BorradorIa } from '../../lib/ia'

const TOTAL = 5

function Asistente({ ajustes }: { ajustes: AjustesIa }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const ctx = useBienvenidaCtx()
  const hw = useHardware()
  const guardar = useGuardarAjustesIa()
  const [paso, setPaso] = useState(1)
  const [borrador, setBorrador] = useState<BorradorIa>(() => borradorDesde(ajustes))
  const [usarServidor, setUsarServidor] = useState(false)
  const [eligio, setEligio] = useState(false)

  const terminar = async (destino: string, conConfig: boolean) => {
    try {
      await guardar.mutate({ body_params: { ...(conConfig ? cambiosDesde(borrador) : {}), bienvenidaCompletada: true } })
      ctx?.marcarCompletada()
      navigate(destino, { replace: true })
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const siguiente = () => setPaso((p) => (p === 2 && usarServidor ? 5 : p + 1))
  const atras = () => setPaso((p) => (p === 5 && usarServidor ? 2 : p - 1))
  const bloqueado = (paso === 2 && !usarServidor && !eligio) || (paso === 3 && faltaClave(borrador, ajustes))
  const conConfig = !usarServidor

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 p-4 md:p-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold text-slate-700">Paso {paso} de {TOTAL}</p>
        <div role="progressbar" aria-label="Avance del asistente" aria-valuemin={1} aria-valuemax={TOTAL} aria-valuenow={paso} className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-blue-700" style={{ width: `${(paso / TOTAL) * 100}%` }} />
        </div>
      </header>

      <section className="flex-1 space-y-4">
        {paso === 1 && (
          <>
            <h1 className="text-2xl font-bold">Te damos la bienvenida</h1>
            <p className="text-slate-700">Esta aplicación junta los correos de tu Outlook en tickets, lee los PDF (también los escritos a mano) y te prepara un resumen de cada caso.</p>
            <p className="rounded-lg bg-blue-50 p-3 text-blue-900">
              <LuShieldCheck className="mr-1.5 -mt-0.5 inline size-5" aria-hidden />Tus datos se quedan en este equipo o servidor. Para escribir los resúmenes necesitamos elegir una inteligencia artificial; te guiamos paso a paso.
            </p>
          </>
        )}

        {paso === 2 && (
          <>
            <h1 className="text-2xl font-bold">Elige tu inteligencia artificial</h1>
            <SelectorProveedor
              value={usarServidor || !eligio ? null : borrador.proveedor}
              hardware={hw.data}
              onChange={(p) => {
                setBorrador((b) => conProveedor(b, ajustes, p))
                setEligio(true)
                setUsarServidor(false)
              }}
            />
            <button
              type="button"
              role="radio"
              aria-checked={usarServidor}
              onClick={() => setUsarServidor(true)}
              className={`min-h-12 w-full rounded-xl border-2 p-4 text-left ${usarServidor ? 'border-blue-700 bg-blue-50' : 'border-slate-200 bg-white'}`}
            >
              <span className="block text-lg font-bold">Usar la configuración actual del servidor</span>
              <span className="block text-slate-700">No cambiamos nada: seguirá usando lo que ya configuró quien administra el servidor.</span>
            </button>
          </>
        )}

        {paso === 3 && (
          <>
            <h1 className="text-2xl font-bold">{borrador.proveedor === 'ollama' ? 'Instala tu IA local' : 'Conecta tu cuenta'}</h1>
            <p className="text-slate-700">Proveedor: <strong>{nombreProveedor(borrador.proveedor)}</strong></p>
            <CredencialesProveedor ajustes={ajustes} borrador={borrador} onChange={setBorrador} hardware={hw.data} onRecheck={() => hw.refetch()} />
          </>
        )}

        {paso === 4 && (
          <>
            <h1 className="text-2xl font-bold">Qué modelo usar en cada tarea</h1>
            <p className="text-slate-700">Ya dejamos una opción recomendada. Puedes cambiarla ahora o después en Ajustes.</p>
            <ModeloPorTarea
              proveedor={borrador.proveedor}
              modelos={borrador.modelos}
              sugeridos={ajustes.sugeridos[borrador.proveedor] ?? { texto: [], vision: [] }}
              onChange={(t, m) => setBorrador((b) => ({ ...b, modelos: { ...b.modelos, [t]: m } }))}
            />
          </>
        )}

        {paso === 5 && (
          <>
            <h1 className="text-2xl font-bold"><LuCheck className="mr-1.5 -mt-1 inline size-6 text-green-700" aria-hidden />Todo listo</h1>
            {usarServidor ? (
              <p className="text-slate-700">Usaremos la configuración actual del servidor.</p>
            ) : (
              <ul className="space-y-1 rounded-xl border border-slate-200 bg-white p-4">
                <li>Proveedor: <strong>{nombreProveedor(borrador.proveedor)}</strong></li>
                {TAREAS.map((t) => <li key={t.id} className="break-all">{t.etiqueta}: <strong>{borrador.modelos[t.id]}</strong></li>)}
              </ul>
            )}
            <p className="text-slate-700">El último paso es conectar tu Outlook para traer tus correos.</p>
            <button type="button" className="btn w-full text-lg" disabled={guardar.loading} onClick={() => void terminar('/ajustes', conConfig)}>Conectar Outlook</button>
            <button type="button" className="btn btn-secondary w-full" disabled={guardar.loading} onClick={() => void terminar('/tickets', conConfig)}>Ir a mis tickets</button>
          </>
        )}
      </section>

      <footer className="space-y-3">
        {paso < TOTAL && (
          <div className="flex gap-3">
            {paso > 1 && <button type="button" className="btn btn-secondary" onClick={atras}><LuArrowLeft className="size-5" aria-hidden />Atrás</button>}
            <button type="button" className="btn flex-1" disabled={bloqueado} onClick={siguiente}>Siguiente<LuArrowRight className="size-5" aria-hidden /></button>
          </div>
        )}
        {paso === 5 && <button type="button" className="btn btn-secondary" onClick={atras}><LuArrowLeft className="size-5" aria-hidden />Atrás</button>}
        {paso < TOTAL && (
          <button type="button" className="btn btn-secondary w-full" disabled={guardar.loading} onClick={() => void terminar('/tickets', false)}>Omitir por ahora</button>
        )}
      </footer>
    </main>
  )
}

export default function Bienvenida() {
  const { data, error, refetch } = useAjustesIa()
  if (error && !data) return <main className="mx-auto max-w-2xl p-4"><ErrorBox message={error} onRetry={() => void refetch()} /></main>
  if (!data) return <Spinner text="Cargando…" full />
  return <Asistente ajustes={data} />
}
