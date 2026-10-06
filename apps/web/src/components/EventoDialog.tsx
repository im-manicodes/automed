import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { LuFilePlus, LuTriangleAlert, LuX } from 'react-icons/lu'
import { useToast } from '../context/toasts-context'
import { ApiError, threadsApi, type Evento, type EventoBorrador, type EventoEstado, type MessageInfo } from '../lib/api'
import { useEsEscritorio } from '../revision/useEsEscritorio'
import AdjuntosRevision from './AdjuntosRevision'
import ConfirmDialog from './ConfirmDialog'
import Markdown from './Markdown'
import { errorMessage } from '../lib/format'
import { ESTADOS, MAX_NOVEDAD, MAX_VALOR } from '../lib/eventos'

const FECHA_MIN = '2000-01-01'

const pad = (n: number) => String(n).padStart(2, '0')
const aDia = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function fechaMax(): string {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  return aDia(d)
}

function diaDeIso(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? aDia(new Date()) : aDia(d)
}

/** Textarea que crece con el contenido (mínimo 2 filas). */
function AutoTextarea({ value, onChange, ...rest }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return <textarea ref={ref} rows={2} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
}

const campoCls = 'w-full rounded-xl border border-slate-300 bg-white p-3 text-base'

function Contador({ n, max }: { n: number; max: number }) {
  if (n < max * 0.9) return null
  return <span className={`text-sm ${n > max ? 'font-semibold text-red-800' : 'text-slate-700'}`}>{n}/{max} caracteres</span>
}

interface Props {
  threadId: string
  /** Asunto del ticket (cabecera). */
  asunto?: string
  /** Markdown de la síntesis vigente, para contrastar. */
  resumen?: string | null
  /** Mensajes del hilo (con sus adjuntos) para la vista previa de PDF. */
  mensajes?: MessageInfo[]
  borrador: EventoBorrador
  onClose: () => void
  /** Se guardó el evento (el padre refresca la lista y avisa). */
  onSaved: (e: Evento) => void
  /** El servidor dijo 409: el padre refresca para mostrar el estado real. */
  onConflict?: () => void
}

type Vista = 'formulario' | 'resumen' | 'adjuntos'

export default function EventoDialog({ threadId, asunto, resumen, mensajes = [], borrador, onClose, onSaved, onConflict }: Props) {
  const { toast } = useToast()
  const uid = useId()
  const dlgRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  const [datos, setDatos] = useState<Record<string, string>>(() =>
    Object.fromEntries(borrador.columnas.map((c) => [c.nombre, borrador.datos[c.nombre] ?? ''])),
  )
  // Se decide una sola vez (al abrir) qué columnas son de una línea, para no cambiar de control mientras se escribe.
  const [cortas] = useState<Set<string>>(
    () => new Set(borrador.columnas.filter((c) => !(borrador.datos[c.nombre] ?? '').includes('\n') && (borrador.datos[c.nombre] ?? '').length <= 40).map((c) => c.nombre)),
  )
  const [estado, setEstado] = useState<EventoEstado>(borrador.estado)
  const [dia, setDia] = useState(() => diaDeIso(borrador.fechaEvento))
  const [novedad, setNovedad] = useState(borrador.novedadTexto ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const max = fechaMax()
  const esLg = useEsEscritorio()
  const [vista, setVista] = useState<Vista>('formulario')
  const [adjuntosVistos, setAdjuntosVistos] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const confirmRef = useRef(false)
  const inicial = useRef({ datos, estado, dia, novedad })
  const sucio = useRef(false)
  useEffect(() => {
    confirmRef.current = confirmando
  })
  useEffect(() => {
    const i = inicial.current
    sucio.current = estado !== i.estado || dia !== i.dia || novedad !== i.novedad || Object.keys(i.datos).some((k) => datos[k] !== i.datos[k])
  }, [datos, estado, dia, novedad])
  // En pantallas grandes el formulario siempre se ve; la pestaña activa de la izquierda es Resumen o Adjuntos.
  const activa: Vista = esLg && vista === 'formulario' ? 'resumen' : vista
  const cambiarVista = (v: Vista) => {
    setVista(v)
    if (v === 'adjuntos') setAdjuntosVistos(true)
  }
  const pedirCerrar = () => {
    if (sucio.current) setConfirmando(true)
    else closeRef.current()
  }
  const pedirCerrarRef = useRef(pedirCerrar)
  useEffect(() => {
    pedirCerrarRef.current = pedirCerrar
  })

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    dlgRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (confirmRef.current) return
      if (e.key === 'Escape') {
        pedirCerrarRef.current()
        return
      }
      if (e.key !== 'Tab' || !dlgRef.current) return
      const foc = Array.from(dlgRef.current.querySelectorAll<HTMLElement>('input, textarea, select, button, a[href], [role="tab"]')).filter(
        (el) => !(el as HTMLButtonElement).disabled && !el.closest('[hidden]'),
      )
      if (foc.length === 0) return
      const first = foc[0]
      const last = foc[foc.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previo?.focus?.()
    }
  }, [])

  const fechaInvalida = !dia || dia < FECHA_MIN || dia > max
  const valorLargo = borrador.columnas.some((c) => (datos[c.nombre] ?? '').length > MAX_VALOR)
  const novedadLarga = novedad.length > MAX_NOVEDAD
  const invalido = fechaInvalida || valorLargo || novedadLarga

  const guardar = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (invalido || saving) return
    setSaving(true)
    setError(null)
    try {
      const original = diaDeIso(borrador.fechaEvento)
      const fechaEvento = dia === original ? borrador.fechaEvento : new Date(`${dia}T12:00:00`).toISOString()
      const creado = await threadsApi.createEvent(threadId, {
        synthesisId: borrador.synthesisId,
        datos,
        estado,
        novedadTexto: novedad.trim() || undefined,
        fechaEvento,
      })
      toast('Añadido al Excel.', 'ok')
      onSaved(creado)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('No se pudo añadir: este resumen ya se añadió, cambió mientras revisabas o el ticket ya no está listo. Cierra esta ventana y revisa «Eventos registrados».')
        onConflict?.()
      } else {
        setError(errorMessage(e))
      }
    } finally {
      setSaving(false)
    }
  }

  const tabs: { v: Vista; label: string }[] = esLg
    ? [{ v: 'resumen', label: 'Resumen' }, { v: 'adjuntos', label: 'Adjuntos' }]
    : [{ v: 'formulario', label: 'Formulario' }, { v: 'resumen', label: 'Resumen' }, { v: 'adjuntos', label: 'Adjuntos' }]
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = tabs.findIndex((x) => x.v === activa)
    const sig = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    cambiarVista(sig.v)
    document.getElementById(`${uid}-tab-${sig.v}`)?.focus()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50">
      <div
        ref={dlgRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        className="absolute inset-0 grid grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)] bg-white lg:grid-cols-[3fr_2fr]"
      >
        <header className="flex items-start gap-3 border-b border-slate-200 p-3 sm:p-4 lg:col-span-2">
          <div className="min-w-0 flex-1 space-y-2">
            <h2 id={`${uid}-title`} className="text-xl font-bold">Añadir al Excel</h2>
            {asunto && <p className="truncate text-slate-700" title={asunto}>{asunto}</p>}
            <p className="rounded-xl border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
              <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Revisa los datos: los propone la inteligencia artificial.
            </p>
          </div>
          <button type="button" className="btn btn-secondary shrink-0" onClick={pedirCerrar}>
            <LuX className="size-5 shrink-0" aria-hidden />Cerrar
          </button>
        </header>

        <div role="tablist" aria-label="Qué quieres ver" onKeyDown={onTabKey} className="flex gap-1 border-b border-slate-200 bg-slate-50 p-2 lg:col-start-1">
          {tabs.map((x) => (
            <button
              key={x.v}
              id={`${uid}-tab-${x.v}`}
              type="button"
              role="tab"
              aria-selected={activa === x.v}
              aria-controls={`${uid}-panel-${x.v}`}
              tabIndex={activa === x.v ? 0 : -1}
              onClick={() => cambiarVista(x.v)}
              className={`btn flex-1 ${activa === x.v ? '' : 'btn-secondary'}`}
            >
              {x.label}
            </button>
          ))}
        </div>

        <section
          id={`${uid}-panel-resumen`}
          role="tabpanel"
          aria-labelledby={`${uid}-tab-resumen`}
          hidden={activa !== 'resumen'}
          className="min-h-0 overflow-y-auto p-4 lg:col-start-1 lg:row-start-3"
        >
          {resumen ? <Markdown>{resumen}</Markdown> : <p className="text-slate-700">Este ticket aún no tiene resumen.</p>}
        </section>

        <section
          id={`${uid}-panel-adjuntos`}
          role="tabpanel"
          aria-labelledby={`${uid}-tab-adjuntos`}
          hidden={activa !== 'adjuntos'}
          className="min-h-0 overflow-y-auto p-4 lg:col-start-1 lg:row-start-3"
        >
          {adjuntosVistos && <AdjuntosRevision mensajes={mensajes} />}
        </section>

        <form
          onSubmit={(e) => void guardar(e)}
          aria-label="Datos para el Excel"
          hidden={!esLg && vista !== 'formulario'}
          className="flex min-h-0 flex-col lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:border-l lg:border-slate-200"
          noValidate
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
            <div className="grid gap-4 xl:grid-cols-2">
              {borrador.columnas.map((c, i) => {
                const id = `${uid}-c${i}`
                const valor = datos[c.nombre] ?? ''
                const cambia = (v: string) => setDatos((d) => ({ ...d, [c.nombre]: v }))
                const corta = cortas.has(c.nombre)
                return (
                  <div key={c.nombre} className={`space-y-1 ${corta ? '' : 'xl:col-span-2'}`}>
                    <label htmlFor={id} className="block font-semibold">{c.nombre}</label>
                    {c.instruccion && <p id={`${id}-h`} className="text-sm text-slate-700">{c.instruccion}</p>}
                    {corta ? (
                      <input id={id} type="text" value={valor} onChange={(e) => cambia(e.target.value)} aria-describedby={c.instruccion ? `${id}-h` : undefined} aria-invalid={valor.length > MAX_VALOR} className={`${campoCls} min-h-11`} />
                    ) : (
                      <AutoTextarea id={id} value={valor} onChange={cambia} aria-describedby={c.instruccion ? `${id}-h` : undefined} aria-invalid={valor.length > MAX_VALOR} className={campoCls} />
                    )}
                    {valor.length > MAX_VALOR ? (
                      <p role="alert" className="text-sm font-semibold text-red-800">«{c.nombre}» es muy largo ({valor.length}/{MAX_VALOR}). Acórtalo.</p>
                    ) : (
                      <Contador n={valor.length} max={MAX_VALOR} />
                    )}
                  </div>
                )
              })}

              <div className="space-y-1">
                <label htmlFor={`${uid}-estado`} className="block font-semibold">Estado</label>
                <select id={`${uid}-estado`} value={estado} onChange={(e) => setEstado(e.target.value as EventoEstado)} className={`${campoCls} min-h-11`}>
                  {ESTADOS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor={`${uid}-fecha`} className="block font-semibold">Fecha del evento</label>
                <input id={`${uid}-fecha`} type="date" value={dia} min={FECHA_MIN} max={max} onChange={(e) => setDia(e.target.value)} aria-invalid={fechaInvalida} className={`${campoCls} min-h-11`} />
                {fechaInvalida && <p role="alert" className="text-sm font-semibold text-red-800">Elige una fecha válida (no puede ser futura).</p>}
              </div>
              <div className="space-y-1 xl:col-span-2">
                <label htmlFor={`${uid}-novedad`} className="block font-semibold">Qué cambió</label>
                <AutoTextarea id={`${uid}-novedad`} value={novedad} onChange={setNovedad} aria-invalid={novedadLarga} className={campoCls} />
                {novedadLarga ? (
                  <p role="alert" className="text-sm font-semibold text-red-800">«Qué cambió» es muy largo ({novedad.length}/{MAX_NOVEDAD}). Acórtalo.</p>
                ) : (
                  <Contador n={novedad.length} max={MAX_NOVEDAD} />
                )}
              </div>
            </div>

            {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">{error}</p>}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white p-4 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={pedirCerrar}>Cancelar</button>
            <button type="submit" className="btn" disabled={invalido || saving}>
              <LuFilePlus className="size-5 shrink-0" aria-hidden />{saving ? 'Guardando…' : 'Añadir al Excel'}
            </button>
          </div>
        </form>

        {confirmando && (
          <ConfirmDialog
            title="¿Salir sin guardar?"
            confirmLabel="Salir sin guardar"
            cancelLabel="Seguir revisando"
            onCancel={() => setConfirmando(false)}
            onConfirm={() => closeRef.current()}
          >
            <p>Tienes cambios sin guardar. Si sales, se pierden.</p>
          </ConfirmDialog>
        )}
      </div>
    </div>
  )
}
