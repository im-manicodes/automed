import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuArrowLeft, LuArrowRight, LuCheck, LuShieldCheck } from 'react-icons/lu'
import ConfigOcr from '../../components/ia/ConfigOcr'
import CredencialesProveedor from '../../components/ia/CredencialesProveedor'
import ModeloPorTarea from '../../components/ia/ModeloPorTarea'
import SelectorProveedor from '../../components/ia/SelectorProveedor'
import ErrorBox from '../../components/ErrorBox'
import Spinner from '../../components/Spinner'
import { useBienvenidaCtx } from '../../components/guarda-bienvenida-context'
import { useToast } from '../../context/toasts-context'
import { useAjustesIa, useGuardarAjustesIa, useHardware } from '../../hooks/useAjustesIa'
import { useAjustesOcr, useAplicarOcr } from '../../hooks/useAjustesOcr'
import type { AjustesIa, MotorOcr } from '../../lib/api'
import { errorMessage } from '../../lib/format'
import { faltaParaOcr, nombreMotorOcr } from '../../lib/ocr'
import { borradorDesde, cambiosDesde, conProveedor, faltaClave, nombreProveedor, TAREAS, type BorradorIa } from '../../lib/ia'

const TOTAL = 6
const PASO_OCR = 5

function Asistente({ inicial }: { inicial: AjustesIa }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const ctx = useBienvenidaCtx()
  const hw = useHardware()
  const guardar = useGuardarAjustesIa()
  const [ajustes, setAjustes] = useState(inicial)
  const [paso, setPaso] = useState(1)
  const [borrador, setBorrador] = useState<BorradorIa>(() => borradorDesde(inicial))
  const [motorElegido, setMotorElegido] = useState<MotorOcr | null>(null)
  const ocr = useAjustesOcr({ enabled: paso >= PASO_OCR })
  const { aplicar, loading: guardandoOcr } = useAplicarOcr()
  const motor = motorElegido ?? ocr.data?.motor ?? 'ninguno'
  const claves = borrador.aws ?? {}
  const faltaOcr = ocr.data ? faltaParaOcr(motor, ocr.data, ajustes, claves) : null
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

  // Guarda la lectura de PDFs elegida (y las claves de AWS nuevas, solo con Textract).
  const guardarOcr = async () => {
    if (!ocr.data) return
    const r = await aplicar({ motor, actual: ocr.data, claves })
    if (r.ia) {
      setAjustes(r.ia)
      setBorrador((b) => ({ ...b, aws: undefined }))
    }
    if (r.ocr) void ocr.refetch()
  }

  const siguiente = async () => {
    if (paso === PASO_OCR) {
      try {
        await guardarOcr()
      } catch (e) {
        toast(errorMessage(e), 'error')
        return
      }
    }
    setPaso((p) => (p === 2 && usarServidor ? PASO_OCR : p + 1))
  }
  const atras = () => setPaso((p) => (p === PASO_OCR && usarServidor ? 2 : p - 1))
  const bloqueado = (paso === 2 && !usarServidor && !eligio) || (paso === 3 && faltaClave(borrador, ajustes)) || (paso === PASO_OCR && (faltaOcr !== null || guardandoOcr))
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

        {paso === PASO_OCR && (
          <>
            <h1 className="text-2xl font-bold">¿Cómo leemos tus PDFs escaneados?</h1>
            <p className="text-slate-700">Los PDF normales se leen directo. Esto es para las páginas escaneadas o escritas a mano.</p>
            {ocr.error && !ocr.data && <ErrorBox message={ocr.error} onRetry={() => void ocr.refetch()} />}
            {!ocr.data && !ocr.error && <Spinner text="Cargando…" />}
            {ocr.data && (
              <>
                <ConfigOcr
                  ajustes={ocr.data}
                  motor={motor}
                  onMotor={setMotorElegido}
                  awsGuardada={ajustes.claves.aws}
                  claves={claves}
                  onClaves={(aws) => setBorrador((b) => ({ ...b, aws }))}
                  onRecheck={() => ocr.refetch()}
                  antesDeProbar={guardarOcr}
                />
                {faltaOcr && <p role="status" className="text-sm text-amber-900">{faltaOcr}</p>}
              </>
            )}
          </>
        )}

        {paso === 6 && (
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
            <p className="rounded-xl border border-slate-200 bg-white p-4">PDFs escaneados: <strong>{nombreMotorOcr(motor)}</strong></p>
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
            <button type="button" className="btn flex-1" disabled={bloqueado} onClick={() => void siguiente()}>Siguiente<LuArrowRight className="size-5" aria-hidden /></button>
          </div>
        )}
        {paso === TOTAL && <button type="button" className="btn btn-secondary" onClick={atras}><LuArrowLeft className="size-5" aria-hidden />Atrás</button>}
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
  return <Asistente inicial={data} />
}
