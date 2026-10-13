import { useEffect, useId, useRef, useState } from 'react'
import { LuArrowLeft, LuDownload, LuFileText, LuRefreshCw, LuTriangleAlert, LuX } from 'react-icons/lu'
import ConfirmDialog from '../../../components/ConfirmDialog'
import ErrorBox from '../../../components/ErrorBox'
import Spinner from '../../../components/Spinner'
import { useToast } from '../../../context/toasts-context'
import { ApiError, type MessageInfo } from '../../../lib/api'
import { errorMessage } from '../../../lib/format'
import { useBorradorFormato } from '../hooks/useBorradorFormato'
import { useBorradorGuardado } from '../hooks/useBorradorGuardado'
import { useDescargarFormato } from '../hooks/useDescargarFormato'
import { useFormatos } from '../hooks/useFormatos'
import { useGuardarBorrador } from '../hooks/useGuardarBorrador'
import { useVistaPreviaFormato } from '../hooks/useVistaPreviaFormato'
import {
  agruparPorSeccion,
  conflictoSexoTriage,
  contarSinLlenar,
  estaLleno,
  paraEnviar,
  type CampoFormato,
  type Formato,
  type ValorCampo,
  type ValoresFormato,
} from '../lib/formatos'
import RevisionSplit from './RevisionSplit'

function fechaGuardado(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}

const campoCls = 'w-full rounded-xl border border-slate-300 bg-white p-3 text-base'

function mensajeBorrador(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) return 'Ahora no se puede llenar: el ticket debe estar listo y con resumen. Cierra esta ventana y revisa el ticket.'
  if (e instanceof ApiError && e.status === 503) return 'La IA no pudo preparar el formato en este momento. Intenta de nuevo en un rato.'
  return errorMessage(e)
}

function CampoInput({ c, valor, onChange, id }: { c: CampoFormato; valor: ValorCampo | undefined; onChange: (v: ValorCampo) => void; id: string }) {
  const texto = typeof valor === 'string' ? valor : ''
  const vacio = !c.soloManual && !estaLleno(c, valor)
  const marca = vacio ? (
    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-sm font-semibold text-amber-900">Falta llenar</span>
  ) : c.soloManual ? (
    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-sm font-semibold text-slate-800">Se llena a mano</span>
  ) : null
  const borde = vacio ? 'border-amber-500' : ''

  if (c.tipo === 'casilla') {
    return (
      <label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-300 bg-white p-3">
        <input type="checkbox" className="size-5 shrink-0" checked={valor === true} onChange={(e) => onChange(e.target.checked)} />
        <span className="font-semibold">{c.etiqueta}</span>
      </label>
    )
  }
  if (c.tipo === 'opcion') {
    return (
      <fieldset className="space-y-1">
        <legend className="font-semibold">{c.etiqueta}{marca}</legend>
        <div className="flex flex-wrap gap-2">
          {(c.opciones ?? []).map((o) => {
            const activa = valor === o.valor
            return (
              <label key={o.valor} className={`btn cursor-pointer ${activa ? '' : 'btn-secondary'}`}>
                <input type="radio" name={id} className="sr-only" checked={activa} onChange={() => onChange(o.valor)} />
                {o.etiqueta}
              </label>
            )
          })}
          {typeof valor === 'string' && valor !== '' && (
            <button type="button" className="btn btn-secondary" onClick={() => onChange(null)}>Quitar</button>
          )}
        </div>
      </fieldset>
    )
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-semibold">{c.etiqueta}{marca}</label>
      {c.tipo === 'texto_largo' ? (
        <textarea id={id} rows={3} value={texto} maxLength={undefined} onChange={(e) => onChange(e.target.value)} className={`${campoCls} ${borde}`} aria-invalid={c.maxLen !== undefined && texto.length > c.maxLen} />
      ) : (
        <input id={id} type={c.tipo === 'fecha' ? 'date' : 'text'} value={texto} onChange={(e) => onChange(e.target.value)} className={`${campoCls} min-h-11 ${borde}`} aria-invalid={c.maxLen !== undefined && texto.length > c.maxLen} />
      )}
      {c.maxLen !== undefined && c.tipo !== 'fecha' && (
        <p className={`text-sm ${texto.length > c.maxLen ? 'font-semibold text-red-800' : 'text-slate-700'}`}>{texto.length}/{c.maxLen} caracteres</p>
      )}
    </div>
  )
}

interface Props {
  threadId: string
  asunto?: string
  /** Markdown de la síntesis vigente, para contrastar. */
  resumen?: string | null
  /** Mensajes del hilo (con adjuntos) para la vista previa de PDF. */
  mensajes?: MessageInfo[]
  onClose: () => void
}

export default function FormatosDialog({ threadId, asunto, resumen, mensajes = [], onClose }: Props) {
  const { toast } = useToast()
  const uid = useId()
  const { data: formatos, loading: cargandoLista, error: errorLista } = useFormatos()
  const { pedir, cargando } = useBorradorFormato(threadId)
  const { guardar } = useGuardarBorrador(threadId)
  const { descargar, descargando } = useDescargarFormato(threadId)
  const { pedir: pedirPrevia, cargando: cargandoPrevia } = useVistaPreviaFormato(threadId)
  const [elegido, setElegido] = useState<Formato | null>(null)
  const [valores, setValores] = useState<ValoresFormato>({})
  const [errorBorrador, setErrorBorrador] = useState<string | null>(null)
  const [erroresIA, setErroresIA] = useState<string[]>([])
  const [errorPdf, setErrorPdf] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<'cerrar' | 'lista' | 'actualizar' | null>(null)
  const [tieneBorrador, setTieneBorrador] = useState(false)
  const [desactualizado, setDesactualizado] = useState(false)
  const [guardadoEn, setGuardadoEn] = useState<string | null>(null)
  const [estadoGuardado, setEstadoGuardado] = useState<'idle' | 'guardando' | 'guardado' | 'error'>('idle')
  const [actualizando, setActualizando] = useState(false)
  const [paginas, setPaginas] = useState<string[] | null>(null)
  const [claveVista, setClaveVista] = useState<string | null>(null)
  const [errorVista, setErrorVista] = useState<string | null>(null)

  const confirmRef = useRef(false)
  const closeRef = useRef(onClose)
  const tieneBorradorRef = useRef(false)
  const valoresRef = useRef(valores)
  const elegidoRef = useRef<Formato | null>(null)
  const guardadoRef = useRef('') // JSON de lo último guardado (o recibido del servidor)
  const enVueloRef = useRef<Promise<void> | null>(null)
  useEffect(() => {
    confirmRef.current = confirmando !== null
    closeRef.current = onClose
    tieneBorradorRef.current = tieneBorrador
    valoresRef.current = valores
    elegidoRef.current = elegido
  })

  const entrar = (v: ValoresFormato) => {
    setValores(v)
    guardadoRef.current = JSON.stringify(paraEnviar(v))
    setEstadoGuardado('idle')
    setPaginas(null)
    setClaveVista(null)
    setErrorVista(null)
    setTieneBorrador(true)
  }

  const primeraPropuesta = async (f: Formato) => {
    try {
      const b = await pedir(f.id)
      entrar(b.valores)
      setErroresIA(b.errores ?? [])
      setDesactualizado(b.desactualizado ?? false)
      setGuardadoEn(b.guardado === false ? null : new Date().toISOString())
    } catch (e) {
      setErrorBorrador(mensajeBorrador(e))
    }
  }

  const { refetch: recargarGuardado, loading: buscandoBorrador } = useBorradorGuardado(threadId, elegido?.id ?? null, {
    onSuccess: (d) => {
      const f = elegidoRef.current
      if (!f) return
      if (d.existe) {
        entrar(d.valores)
        setErroresIA([])
        setDesactualizado(d.desactualizado)
        setGuardadoEn(d.actualizadoEn)
      } else void primeraPropuesta(f)
    },
    onError: (m) => setErrorBorrador(m),
  })

  /** Guarda lo pendiente. Devuelve true si no queda nada sin guardar. */
  const guardarAhora = async (): Promise<boolean> => {
    const f = elegidoRef.current
    if (!f || !tieneBorradorRef.current) return true
    if (enVueloRef.current) await enVueloRef.current
    const enviar = paraEnviar(valoresRef.current)
    const clave = JSON.stringify(enviar)
    if (clave === guardadoRef.current) return true
    setEstadoGuardado('guardando')
    const p = (async () => {
      try {
        await guardar(f.id, enviar)
        guardadoRef.current = clave
        setGuardadoEn(new Date().toISOString())
        setEstadoGuardado(JSON.stringify(paraEnviar(valoresRef.current)) === clave ? 'guardado' : 'guardando')
      } catch {
        setEstadoGuardado('error')
      }
    })()
    enVueloRef.current = p
    await p
    enVueloRef.current = null
    return JSON.stringify(paraEnviar(valoresRef.current)) === guardadoRef.current
  }
  const guardarRef = useRef(guardarAhora)
  useEffect(() => {
    guardarRef.current = guardarAhora
  })

  // Autoguardado con debounce al editar.
  useEffect(() => {
    if (!tieneBorrador || JSON.stringify(paraEnviar(valores)) === guardadoRef.current) return
    const t = setTimeout(() => void guardarRef.current(), 1500)
    return () => clearTimeout(t)
  }, [valores, tieneBorrador])

  const pedirCerrar = async () => {
    if (await guardarRef.current()) closeRef.current()
    else setConfirmando('cerrar')
  }
  const pedirCerrarRef = useRef(pedirCerrar)
  useEffect(() => {
    pedirCerrarRef.current = pedirCerrar
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmRef.current && !tieneBorradorRef.current) void pedirCerrarRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const cargar = (f: Formato) => {
    const mismo = elegido?.id === f.id
    setElegido(f)
    setTieneBorrador(false)
    setErrorBorrador(null)
    setErrorPdf(null)
    if (mismo) void recargarGuardado()
  }

  const aLista = () => {
    setElegido(null)
    setTieneBorrador(false)
    setErrorBorrador(null)
    setEstadoGuardado('idle')
  }
  const volver = async () => {
    if (!tieneBorrador || (await guardarRef.current())) aLista()
    else setConfirmando('lista')
  }

  const actualizarConIA = async () => {
    if (!elegido) return
    setConfirmando(null)
    setActualizando(true)
    setErrorPdf(null)
    try {
      if (!(await guardarRef.current())) throw new Error('No se pudieron guardar tus cambios antes de actualizar. Intenta de nuevo.')
      const b = await pedir(elegido.id, true)
      setValores(b.valores)
      guardadoRef.current = JSON.stringify(paraEnviar(b.valores))
      setEstadoGuardado('guardado')
      setErroresIA(b.errores ?? [])
      setDesactualizado(b.desactualizado ?? false)
      setGuardadoEn(new Date().toISOString())
      toast('Datos actualizados con el resumen nuevo.', 'ok')
    } catch (e) {
      setErrorPdf(e instanceof ApiError ? mensajeBorrador(e) : errorMessage(e))
    } finally {
      setActualizando(false)
    }
  }

  const claveActual = JSON.stringify(paraEnviar(valores))
  const pedirVista = async () => {
    if (!elegido) return
    setErrorVista(null)
    const clave = claveActual
    try {
      setPaginas(await pedirPrevia(elegido.id, paraEnviar(valores)))
      setClaveVista(clave)
    } catch (e) {
      setErrorVista(errorMessage(e))
    }
  }
  const abrirVista = () => {
    if (paginas === null && !cargandoPrevia) void pedirVista()
  }

  const sinLlenar = elegido ? contarSinLlenar(elegido, valores) : 0
  const largo = elegido?.campos.some((c) => c.maxLen !== undefined && typeof valores[c.clave] === 'string' && (valores[c.clave] as string).length > c.maxLen) ?? false
  const avisoSexoTriage = elegido ? conflictoSexoTriage(elegido.id, valores) : false

  const bajar = async () => {
    if (!elegido) return
    setErrorPdf(null)
    try {
      await guardarRef.current()
      const enviar = paraEnviar(valores)
      await descargar(elegido.id, enviar)
      toast('PDF descargado.', 'ok')
    } catch (e) {
      setErrorPdf(errorMessage(e))
    }
  }

  const cambiar = (clave: string, v: ValorCampo) => setValores((x) => ({ ...x, [clave]: v }))

  const confirmar =
    confirmando === 'actualizar' ? (
      <ConfirmDialog
        title="¿Actualizar con la IA?"
        confirmLabel="Actualizar con IA"
        cancelLabel="Ahora no"
        onCancel={() => setConfirmando(null)}
        onConfirm={() => void actualizarConIA()}
      >
        <p>La IA vuelve a leer el resumen nuevo y solo rellena lo que tú no editaste. Tus cambios se conservan.</p>
      </ConfirmDialog>
    ) : confirmando ? (
      <ConfirmDialog
        title="No se pudieron guardar tus cambios"
        confirmLabel="Salir de todos modos"
        cancelLabel="Seguir revisando"
        onCancel={() => setConfirmando(null)}
        onConfirm={() => {
          const d = confirmando
          setConfirmando(null)
          if (d === 'cerrar') closeRef.current()
          else aLista()
        }}
      >
        <p>Los últimos cambios no se guardaron. Si sales, se pierden.</p>
      </ConfirmDialog>
    ) : null

  const indicador =
    estadoGuardado === 'guardando' ? (
      <span role="status">Guardando…</span>
    ) : estadoGuardado === 'error' ? (
      <span role="alert" className="font-semibold text-red-800">
        No se pudo guardar.{' '}
        <button type="button" className="btn btn-secondary" onClick={() => void guardarRef.current()}>Reintentar</button>
      </span>
    ) : estadoGuardado === 'guardado' ? (
      <span role="status">Guardado</span>
    ) : null

  const cambiosVista = paginas !== null && claveVista !== claveActual
  const vistaPrevia = (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">Es una imagen de referencia. El PDF que descargas queda editable.</p>
      <button type="button" className="btn btn-secondary" disabled={cargandoPrevia} onClick={() => void pedirVista()}>
        <LuRefreshCw className="size-5 shrink-0" aria-hidden />Actualizar vista previa
      </button>
      {cambiosVista && !cargandoPrevia && (
        <p role="status" className="rounded-xl border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">Hay cambios nuevos: actualiza la vista previa.</p>
      )}
      {cargandoPrevia && <Spinner text="Preparando la vista previa…" />}
      {errorVista && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">
          {errorVista}{' '}
          <button type="button" className="btn" onClick={() => void pedirVista()}>Reintentar</button>
        </p>
      )}
      {(paginas ?? []).map((src, i) => (
        <img key={i} src={src} alt={`Página ${i + 1} del formato`} className="mx-auto w-full max-w-3xl rounded border border-slate-300 bg-white" />
      ))}
    </div>
  )

  if (elegido && tieneBorrador) {
    return (
      <RevisionSplit
        titulo={elegido.titulo}
        asunto={asunto}
        aviso={
          <p className="rounded-xl border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
            <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Revisa los datos: los propone la inteligencia artificial.
          </p>
        }
        resumen={resumen}
        mensajes={mensajes}
        onCerrar={() => void pedirCerrar()}
        confirmando={confirmando !== null}
        extras={[{ id: 'vista-previa', label: 'Vista previa', contenido: vistaPrevia, onAbrir: abrirVista }]}
        formulario={
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold" role="status">
                  {sinLlenar === 0 ? 'Todo lleno' : `${sinLlenar} ${sinLlenar === 1 ? 'campo sin llenar' : 'campos sin llenar'}`}
                </p>
                <p className="text-sm text-slate-700">
                  {guardadoEn && <span>Guardado el {fechaGuardado(guardadoEn)}. </span>}
                  {indicador}
                </p>
              </div>
              {desactualizado && (
                <div className="space-y-2 rounded-xl border border-amber-400 bg-amber-50 p-3 text-amber-900">
                  <p className="font-semibold"><LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />El resumen cambió desde esta propuesta.</p>
                  <p className="text-sm">«Actualizar con IA» solo rellena lo que no editaste; tus cambios se conservan.</p>
                  <button type="button" className="btn" disabled={actualizando} onClick={() => setConfirmando('actualizar')}>
                    <LuRefreshCw className="size-5 shrink-0" aria-hidden />{actualizando ? 'Actualizando…' : 'Actualizar con IA'}
                  </button>
                </div>
              )}
              {erroresIA.length > 0 && (
                <p className="rounded-xl border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
                  Algunos datos propuestos no eran válidos y se dejaron en blanco.
                </p>
              )}
              {avisoSexoTriage && (
                <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">
                  <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
                  En este PDF el sexo y el triage comparten el mismo grupo de opciones: si eliges los dos, el triage no aparecerá en el documento. Solo se imprimirá el sexo.
                </p>
              )}
              {agruparPorSeccion(elegido.campos.filter((c) => !c.soloManual)).map((g) => (
                <section key={g.seccion} aria-label={g.seccion} className="space-y-3">
                  <h3 className="text-lg font-bold">{g.seccion}</h3>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {g.campos.map((c) => (
                      <div key={c.clave} className={c.tipo === 'texto_largo' ? 'xl:col-span-2' : ''}>
                        <CampoInput c={c} valor={valores[c.clave]} onChange={(v) => cambiar(c.clave, v)} id={`${uid}-${c.clave}`} />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              {elegido.campos.some((c) => c.soloManual) && (
                <details className="rounded-xl border border-slate-300 p-3">
                  <summary className="cursor-pointer font-semibold">Se llena a mano (opcional)</summary>
                  <div className="mt-3 space-y-4">
                    {agruparPorSeccion(elegido.campos.filter((c) => c.soloManual)).map((g) => (
                      <section key={g.seccion} aria-label={`${g.seccion} (a mano)`} className="space-y-3">
                        <h3 className="text-lg font-bold">{g.seccion}</h3>
                        <div className="grid gap-4 xl:grid-cols-2">
                          {g.campos.map((c) => (
                            <div key={c.clave} className={c.tipo === 'texto_largo' ? 'xl:col-span-2' : ''}>
                              <CampoInput c={c} valor={valores[c.clave]} onChange={(v) => cambiar(c.clave, v)} id={`${uid}-${c.clave}`} />
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </details>
              )}
              {errorPdf && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">{errorPdf}</p>}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white p-4 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-secondary" onClick={() => void volver()}><LuArrowLeft className="size-5 shrink-0" aria-hidden />Otro formato</button>
              <button type="button" className="btn" disabled={descargando || largo} onClick={() => void bajar()}>
                <LuDownload className="size-5 shrink-0" aria-hidden />{descargando ? 'Preparando el PDF…' : 'Descargar PDF'}
              </button>
            </div>
          </>
        }
      >
        {confirmar}
      </RevisionSplit>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50">
      <div role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} className="absolute inset-0 flex flex-col bg-white">
        <header className="flex items-start gap-3 border-b border-slate-200 p-3 sm:p-4">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 id={`${uid}-title`} className="text-xl font-bold">{elegido ? elegido.titulo : 'Llenar formatos'}</h2>
            {asunto && <p className="truncate text-slate-700" title={asunto}>{asunto}</p>}
          </div>
          <button type="button" className="btn btn-secondary shrink-0" onClick={() => void pedirCerrar()}>
            <LuX className="size-5 shrink-0" aria-hidden />Cerrar
          </button>
        </header>

        {!elegido && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <p className="text-slate-700">Elige el formato. La IA propone los datos con el resumen del ticket y tú los revisas antes de descargar.</p>
            {cargandoLista && <Spinner text="Cargando formatos…" />}
            {errorLista && <ErrorBox message={errorLista} />}
            <ul className="space-y-2">
              {(formatos ?? []).map((f) => (
                <li key={f.id}>
                  <button type="button" className="btn btn-secondary w-full justify-start" onClick={() => cargar(f)}>
                    <LuFileText className="size-5 shrink-0" aria-hidden />{f.titulo}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {elegido && !tieneBorrador && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {buscandoBorrador && !cargando && !errorBorrador && <Spinner text="Abriendo el formato…" />}
            {(cargando || actualizando) && <Spinner text="La IA está preparando el formato…" />}
            {errorBorrador && (
              <>
                <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">{errorBorrador}</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" className="btn" onClick={() => cargar(elegido)}><LuRefreshCw className="size-5 shrink-0" aria-hidden />Reintentar</button>
                  <button type="button" className="btn btn-secondary" onClick={() => void volver()}><LuArrowLeft className="size-5 shrink-0" aria-hidden />Elegir otro formato</button>
                </div>
              </>
            )}
          </div>
        )}

        {confirmar}
      </div>
    </div>
  )
}
