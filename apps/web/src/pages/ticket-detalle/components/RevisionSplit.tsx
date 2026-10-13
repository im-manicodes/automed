import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { LuX } from 'react-icons/lu'
import Markdown from '../../../components/Markdown'
import { useEsEscritorio } from '../../../hooks/useEsEscritorio'
import type { MessageInfo } from '../../../lib/api'
import AdjuntosRevision from './AdjuntosRevision'

type Vista = string

export interface PestanaExtra {
  id: string
  label: string
  contenido: ReactNode
  /** Se llama cada vez que el usuario abre la pestaña. */
  onAbrir?: () => void
}

interface Props {
  titulo: string
  /** Asunto del ticket (cabecera). */
  asunto?: string
  /** Aviso bajo el asunto (p. ej. «Revisa los datos…»). */
  aviso?: ReactNode
  /** Markdown de la síntesis vigente, para contrastar. */
  resumen?: string | null
  /** Mensajes del hilo (con sus adjuntos) para la vista previa de PDF. */
  mensajes?: MessageInfo[]
  /** Formulario (columna derecha en escritorio; pestaña «Formulario» en móvil). */
  formulario: ReactNode
  /** Nombre accesible del formulario (solo informativo para la pestaña). */
  etiquetaFormulario?: string
  /** Se pidió cerrar (botón Cerrar o Escape). El padre decide si confirma. */
  onCerrar: () => void
  /** true mientras hay una confirmación abierta: se desactivan Escape y la trampa de foco. */
  confirmando?: boolean
  /** Pestañas/paneles extra junto a Resumen y Adjuntos (p. ej. «Vista previa»). */
  extras?: PestanaExtra[]
  /** Confirmaciones u otros diálogos hijos. */
  children?: ReactNode
}

/** Esqueleto compartido de revisión: resumen/adjuntos a la izquierda, formulario a la derecha. */
export default function RevisionSplit({ titulo, asunto, aviso, resumen, mensajes = [], formulario, etiquetaFormulario = 'Formulario', extras = [], onCerrar, confirmando = false, children }: Props) {
  const uid = useId()
  const dlgRef = useRef<HTMLDivElement>(null)
  const esLg = useEsEscritorio()
  const [vista, setVista] = useState<Vista>('formulario')
  const [adjuntosVistos, setAdjuntosVistos] = useState(false)
  const cerrarRef = useRef(onCerrar)
  const confirmRef = useRef(confirmando)
  useEffect(() => {
    cerrarRef.current = onCerrar
    confirmRef.current = confirmando
  })

  // En pantallas grandes el formulario siempre se ve; la pestaña activa de la izquierda es Resumen o Adjuntos.
  const activa: Vista = esLg && vista === 'formulario' ? 'resumen' : vista
  const cambiarVista = (v: Vista) => {
    setVista(v)
    if (v === 'adjuntos') setAdjuntosVistos(true)
    extras.find((x) => x.id === v)?.onAbrir?.()
  }

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    dlgRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (confirmRef.current) return
      if (e.key === 'Escape') {
        cerrarRef.current()
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

  const ex = extras.map((x) => ({ v: x.id, label: x.label }))
  const tabs: { v: Vista; label: string }[] = esLg
    ? [{ v: 'resumen', label: 'Resumen' }, { v: 'adjuntos', label: 'Adjuntos' }, ...ex]
    : [{ v: 'formulario', label: etiquetaFormulario }, { v: 'resumen', label: 'Resumen' }, { v: 'adjuntos', label: 'Adjuntos' }, ...ex]
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
            <h2 id={`${uid}-title`} className="text-xl font-bold">{titulo}</h2>
            {asunto && <p className="truncate text-slate-700" title={asunto}>{asunto}</p>}
            {aviso}
          </div>
          <button type="button" className="btn btn-secondary shrink-0" onClick={onCerrar}>
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

        {extras.map((x) => (
          <section
            key={x.id}
            id={`${uid}-panel-${x.id}`}
            role="tabpanel"
            aria-labelledby={`${uid}-tab-${x.id}`}
            hidden={activa !== x.id}
            className="min-h-0 overflow-y-auto p-4 lg:col-start-1 lg:row-start-3"
          >
            {x.contenido}
          </section>
        ))}

        <div
          hidden={!esLg && vista !== 'formulario'}
          className="flex min-h-0 flex-col lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:border-l lg:border-slate-200"
        >
          {formulario}
        </div>

        {children}
      </div>
    </div>
  )
}
