import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import AttachmentRow from './components/AttachmentRow'
import AvisoRevision from './components/AvisoRevision'
import ConfirmDialog from '../../components/ConfirmDialog'
import ErrorBox from '../../components/ErrorBox'
import Markdown from '../../components/Markdown'
import Spinner from '../../components/Spinner'
import StatusBadge from '../../components/StatusBadge'
import Switch from '../../components/Switch'
import VersionHistory from './components/VersionHistory'
import { useToast } from '../../context/toasts-context'
import { ApiError, type Evento, type EventoBorrador } from '../../lib/api'
import { errorMessage, formatDate, formatDia, plural, slugify } from '../../lib/format'
import { canAnalyze, isBusy } from '../../lib/status'
import ProgresoAnalisis from '../../components/ProgresoAnalisis'
import { copiarTexto } from '../../lib/clipboard'
import WhatsappDialog from './components/WhatsappDialog'
import EventoDialog from './components/EventoDialog'
import EventosRegistrados from './components/EventosRegistrados'
import { usePolling } from '../../hooks/usePolling'
import { useTicketDetalle } from './hooks/useTicketDetalle'
import { useTicketAcciones } from './hooks/useTicketAcciones'
import { LuArrowLeft, LuHourglass, LuTriangleAlert, LuMail, LuFileText, LuCopy, LuDownload, LuArrowUpRight, LuArrowDownLeft, LuPaperclip, LuMessageCircle, LuFilePlus, LuRefreshCw, LuRotateCw } from 'react-icons/lu'

type Tab = 'resumen' | 'correos' | 'adjuntos'
const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'correos', label: 'Correos' },
  { id: 'adjuntos', label: 'Adjuntos' },
]

export default function TicketDetalle() {
  const { id = '' } = useParams()
  const { toast } = useToast()
  const { thread, synth, eventos, eventoSynthId, error, refetch } = useTicketDetalle(id)
  const acciones = useTicketAcciones(id)
  const { waLoading, evLoading } = acciones
  // El tab activo vive en la URL (?tab=correos): sobrevive a refrescar la página.
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: Tab = TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : 'resumen'
  const setTab = (t: Tab) => setParams(t === 'resumen' ? {} : { tab: t }, { replace: true })
  const [busy, setBusy] = useState(false)
  const [waTexto, setWaTexto] = useState<string | null>(null)
  const [borrador, setBorrador] = useState<EventoBorrador | null>(null)
  const [yaAnadido, setYaAnadido] = useState<Evento | null>(null)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [confirmUltimo, setConfirmUltimo] = useState(false)
  const [confirmTodo, setConfirmTodo] = useState(false)
  const [confirmSinRevision, setConfirmSinRevision] = useState(false)

  usePolling(() => void refetch(), 5000, !!thread && isBusy(thread.status))

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true)
    try {
      await fn()
      toast(okMsg, 'ok')
      await refetch()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <ErrorBox message={error} onRetry={() => void refetch()} />
  if (!thread || !synth) return <Spinner text="Cargando el ticket…" />

  const latest = synth.latest
  const analyzable = canAnalyze(thread)
  const analyzed = thread.status === 'listo' || thread.status === 'necesita_revision'
  const analyzeLabel =
    thread.status === 'error' ? 'Reintentar análisis' : thread.tieneMensajesNuevos && analyzed ? 'Actualizar resumen' : 'Analizar este ticket'
  const attachmentCount = thread.messages.reduce((n, m) => n + m.attachments.length, 0)
  const porRevisar =
    thread.status === 'necesita_revision'
      ? thread.messages.flatMap((m) => m.attachments).filter((a) => a.status === 'necesita_revision').map((a) => ({ id: a.id, filename: a.filename }))
      : []

  const copy = async () => {
    if (!latest) return
    if (await copiarTexto(latest.markdown)) toast('Resumen copiado.', 'ok')
    else toast('No se pudo copiar. Prueba con “Descargar .md”.', 'error')
  }
  const waRazon = thread.messages.length === 0 ? 'Este ticket no tiene correos.' : isBusy(thread.status) ? 'Espera a que termine el análisis.' : ''
  const openWhatsApp = async () => {
    try {
      setWaTexto((await acciones.whatsappLast()).texto)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const eventoVigente = eventoSynthId ? eventos.find((e) => e.synthesisId === eventoSynthId) : undefined
  const evRazon = eventoVigente
    ? ''
    : isBusy(thread.status)
      ? 'Espera a que termine el análisis.'
      : thread.status === 'necesita_revision'
        ? 'Resuelve las dudas del PDF primero.'
        : thread.status === 'error'
          ? 'El análisis falló. Vuelve a analizar el ticket primero.'
          : thread.status !== 'listo'
            ? 'Analiza este ticket primero.'
            : ''
  const irAEventos = () => document.getElementById('eventos')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const openEvento = async () => {
    try {
      const b = await acciones.eventDraft()
      if (b.yaRegistrado) setYaAnadido(b.yaRegistrado)
      else setBorrador(b)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast('Ahora no se puede añadir: el ticket debe estar listo y con resumen.', 'error')
        void refetch()
      } else toast(errorMessage(e), 'error')
    }
  }
  const quitarEvento = async (eid: string) => {
    try {
      await acciones.removeEvent(eid)
      toast('Evento quitado del Excel.', 'ok')
      await refetch()
    } catch (e) {
      toast(errorMessage(e), 'error')
      throw e
    }
  }
  const download = () => {
    if (!latest) return
    const url = URL.createObjectURL(new Blob([latest.markdown], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${slugify(thread.subject)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <article className="space-y-4">
      <Link to="/tickets" className="inline-flex min-h-11 items-center text-blue-800 underline"><LuArrowLeft className="mr-2 size-5" aria-hidden />Volver a los tickets</Link>
      <h2 className="break-words text-2xl font-bold">{thread.subject || '(Sin asunto)'}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={thread.status} />
        <span className="text-sm text-slate-700">{plural(thread.messages.length, 'correo', 'correos')} · {plural(attachmentCount, 'PDF', 'PDF')}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
        <aside aria-label="Estado y acciones" className="space-y-4 lg:sticky lg:top-6 lg:order-last">
          {isBusy(thread.status) && (
            <div className="space-y-2 rounded-xl border border-blue-300 bg-blue-50 p-3 text-blue-900">
              <p role="status">
                <LuHourglass className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Estamos analizando este ticket. Se actualiza solo; puedes salir y volver luego.
              </p>
              <ProgresoAnalisis progreso={thread.progreso} />
            </div>
          )}
          {thread.status === 'error' && (
            <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">
              <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />El análisis no pudo terminar. Puedes intentarlo otra vez.
            </p>
          )}
          <AvisoRevision threadId={thread.id} pendientes={porRevisar} busy={busy} onContinuar={() => setConfirmSinRevision(true)} />
          {thread.tieneMensajesNuevos && (
            <p className="rounded-xl border border-violet-300 bg-violet-50 p-3 text-violet-900">
              <LuMail className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Llegaron mensajes nuevos que aún no están en el resumen.
            </p>
          )}

          {analyzable && (
            <div className="space-y-1">
              <button type="button" className="btn w-full" disabled={busy} onClick={() => void run(() => acciones.analyze(), 'Analizando. Esto puede tardar unos minutos.')}>
                {analyzeLabel}
              </button>
              <p className="text-sm text-slate-700">Usa inteligencia artificial. Si ya hay resumen, solo se lee lo nuevo.</p>
            </div>
          )}

          {!isBusy(thread.status) && thread.messages.length > 0 && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
              <div className="space-y-1">
                <button type="button" className="btn btn-secondary w-full" disabled={busy} onClick={() => setConfirmUltimo(true)}>
                  <LuRefreshCw className="size-5 shrink-0" aria-hidden />Re-analizar el último correo
                </button>
                <p className="text-sm text-slate-700">Vuelve a leer solo el último correo y actualiza el resumen.</p>
              </div>
              <div className="space-y-1">
                <button type="button" className="btn btn-secondary w-full" disabled={busy} onClick={() => setConfirmTodo(true)}>
                  <LuRotateCw className="size-5 shrink-0" aria-hidden />Re-analizar todo el hilo
                </button>
                <p className="text-sm text-slate-700">Vuelve a leer todo desde cero. Consume mucho más.</p>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <Switch
              label="Seguimiento automático"
              checked={thread.seguimiento}
              disabled={busy}
              onChange={(v) => void run(() => acciones.setSeguimiento(v), v ? 'Seguimiento activado.' : 'Seguimiento apagado.')}
            />
            <p className="text-sm text-slate-700">
              Si lo activas, cuando llegue un mensaje nuevo a este ticket el resumen se actualiza solo (usa inteligencia artificial). Apagado, solo te avisamos.
            </p>
          </div>

          {synth.plantillaDesactualizada && (
            <div className="space-y-2 rounded-xl border border-amber-400 bg-amber-50 p-3 text-amber-900">
              <p><LuFileText className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />La plantilla cambió después de escribir este resumen. Las actualizaciones siguen con la plantilla anterior.</p>
              <button type="button" className="btn btn-secondary" disabled={busy || isBusy(thread.status)} onClick={() => setConfirmRegen(true)}>
                Regenerar con la plantilla nueva
              </button>
            </div>
          )}
        </aside>
        <div className="min-w-0 space-y-4">
          <div role="tablist" aria-label="Secciones del ticket" className="flex gap-1 border-b border-slate-300">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`min-h-12 flex-1 border-b-4 px-2 font-semibold md:flex-none md:px-6 ${tab === t.id ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-700'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'resumen' && (
            <div role="tabpanel" id="panel-resumen" aria-labelledby="tab-resumen" className="space-y-4">
              {latest ? (
                <>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <Markdown>{latest.markdown}</Markdown>
                  </div>
                  <p className="text-sm text-slate-700">
                    Versión {latest.version} · {latest.mode === 'full' ? 'completa' : 'actualizada con lo nuevo'} · {formatDate(latest.createdAt)}
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button type="button" className="btn btn-secondary flex-1" onClick={() => void copy()}><LuCopy className="size-5 shrink-0" aria-hidden />Copiar resumen</button>
                    <button type="button" className="btn btn-secondary flex-1" onClick={download}><LuDownload className="size-5 shrink-0" aria-hidden />Descargar .md</button>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button type="button" className="btn btn-secondary flex-1" disabled={waLoading || !!waRazon} onClick={() => void openWhatsApp()}>
                      <LuMessageCircle className="size-5 shrink-0" aria-hidden />{waLoading ? 'Preparando el mensaje…' : 'Mensaje para WhatsApp'}
                    </button>
                  </div>
                  {waRazon && <p className="text-sm text-slate-700">{waRazon}</p>}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {eventoVigente ? (
                      <button type="button" className="btn btn-secondary flex-1" disabled aria-describedby="ev-ayuda">
                        <LuFilePlus className="size-5 shrink-0" aria-hidden />Ya añadido el {formatDia(eventoVigente.fecha)}
                      </button>
                    ) : (
                      <button type="button" className="btn btn-secondary flex-1" disabled={evLoading || !!evRazon} aria-describedby={evRazon ? 'ev-ayuda' : undefined} onClick={() => void openEvento()}>
                        <LuFilePlus className="size-5 shrink-0" aria-hidden />{evLoading ? 'Leyendo la actualización…' : 'Añadir al Excel'}
                      </button>
                    )}
                  </div>
                  {(evRazon || eventoVigente) && (
                    <p id="ev-ayuda" className="text-sm text-slate-700">
                      {evRazon}
                      {eventoVigente && (
                        <>
                          Esta versión del resumen ya está en el Excel.{' '}
                          <a href="#eventos" onClick={(e) => { e.preventDefault(); irAEventos() }} className="font-semibold text-blue-800 underline">Ver eventos registrados</a>
                        </>
                      )}
                    </p>
                  )}
                  <EventosRegistrados eventos={eventos} onRemove={quitarEvento} />
                  <VersionHistory history={synth.history} />
                </>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-700">
                  {isBusy(thread.status) ? 'El resumen aparecerá aquí en unos minutos.' : 'Todavía no hay resumen. Pulsa “Analizar este ticket” para crearlo.'}
                </p>
              )}
            </div>
          )}

          {tab === 'correos' && (
            <ol role="tabpanel" id="panel-correos" aria-labelledby="tab-correos" className="space-y-3">
              {thread.messages.map((m) => (
                <li key={m.id} className={`space-y-2 rounded-xl border p-3 ${m.isFromMe ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${m.isFromMe ? 'border-blue-400 bg-white text-blue-900' : 'border-slate-300 bg-slate-100 text-slate-800'}`}>
                      {m.isFromMe ? <LuArrowUpRight className="mr-1 -mt-0.5 inline size-4" aria-hidden /> : <LuArrowDownLeft className="mr-1 -mt-0.5 inline size-4" aria-hidden />}{m.isFromMe ? 'Enviado por mí' : 'Recibido'}
                    </span>
                    <span className="text-sm text-slate-700">{formatDate(m.receivedAt)}</span>
                  </div>
                  <p className="break-all text-sm text-slate-800">De: {m.from}</p>
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2 font-medium">Ver el mensaje</summary>
                    <p className="whitespace-pre-wrap break-words text-base">{m.bodyText || '(Sin texto)'}</p>
                  </details>
                  {m.attachments.length > 0 && <p className="text-sm text-slate-700"><LuPaperclip className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />{plural(m.attachments.length, 'archivo adjunto', 'archivos adjuntos')}</p>}
                </li>
              ))}
            </ol>
          )}

          {tab === 'adjuntos' && (
            <div role="tabpanel" id="panel-adjuntos" aria-labelledby="tab-adjuntos" className="space-y-4">
              {attachmentCount === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-700">Este ticket no tiene PDF.</p>}
              {thread.messages
                .filter((m) => m.attachments.length > 0)
                .map((m) => (
                  <section key={m.id} className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-700">
                      {m.isFromMe ? 'Enviado por mí' : 'Recibido'} · {formatDate(m.receivedAt)}
                    </h3>
                    <ul className="space-y-2">
                      {m.attachments.map((a) => (
                        <AttachmentRow key={a.id} threadId={thread.id} att={a} />
                      ))}
                    </ul>
                  </section>
                ))}
            </div>
          )}
        </div>
      </div>

      {borrador && (
        <EventoDialog
          threadId={id}
          asunto={thread.subject}
          resumen={latest?.markdown ?? null}
          mensajes={thread.messages}
          borrador={borrador}
          onClose={() => setBorrador(null)}
          onSaved={() => {
            setBorrador(null)
            void refetch()
          }}
          onConflict={() => void refetch()}
        />
      )}

      {yaAnadido && (
        <ConfirmDialog
          title={`Ya añadido el ${formatDia(yaAnadido.fecha)}`}
          confirmLabel="Ver eventos"
          cancelLabel="Cerrar"
          onCancel={() => setYaAnadido(null)}
          onConfirm={() => {
            setYaAnadido(null)
            setTimeout(irAEventos, 0)
            void refetch()
          }}
        >
          <p>Esta versión del resumen ya está en el Excel. Para añadir otra actualización, analiza el ticket de nuevo cuando lleguen novedades.</p>
        </ConfirmDialog>
      )}

      {waTexto !== null && <WhatsappDialog initial={waTexto} onClose={() => setWaTexto(null)} />}

      {confirmUltimo && (
        <ConfirmDialog
          title="¿Re-analizar el último correo?"
          confirmLabel="Sí, re-analizar"
          busy={busy}
          onCancel={() => setConfirmUltimo(false)}
          onConfirm={() => {
            void run(() => acciones.reanalyzeLast(), 'Re-analizando el último correo.').finally(() => setConfirmUltimo(false))
          }}
        >
          <p>Se vuelve a leer solo el último correo (y sus PDF, con OCR) con inteligencia artificial y se actualiza el resumen.</p>
          <p>Los correos anteriores no se envían otra vez.</p>
        </ConfirmDialog>
      )}

      {confirmTodo && (
        <ConfirmDialog
          title="¿Re-analizar todo el hilo?"
          confirmLabel="Sí, re-analizar todo"
          busy={busy}
          onCancel={() => setConfirmTodo(false)}
          onConfirm={() => {
            void run(() => acciones.reprocess(), 'Re-analizando todo el hilo. Puede tardar varios minutos.').finally(() => setConfirmTodo(false))
          }}
        >
          <p><strong>Atención:</strong> se vuelve a leer TODO el hilo, correos y PDF (incluido el OCR), con inteligencia artificial.</p>
          <p>Consume <strong>mucho más</strong> que una actualización normal y puede tardar varios minutos.</p>
          <p>Úsalo solo si el resumen quedó mal. Para lo último que llegó, mejor “Re-analizar el último correo”.</p>
        </ConfirmDialog>
      )}

      {confirmSinRevision && (
        <ConfirmDialog
          title="¿Generar el resumen sin corregir?"
          confirmLabel="Sí, generar el resumen"
          busy={busy}
          onCancel={() => setConfirmSinRevision(false)}
          onConfirm={() => {
            void run(() => acciones.continuar(), 'Generando el resumen.').finally(() => setConfirmSinRevision(false))
          }}
        >
          <p>Las partes marcadas en rojo que no corrijas se dejarán <strong>fuera del resumen</strong>.</p>
          <p>Puedes corregirlas después y el resumen se actualizará.</p>
        </ConfirmDialog>
      )}

      {confirmRegen && (
        <ConfirmDialog
          title="¿Regenerar el resumen completo?"
          confirmLabel="Sí, regenerar"
          busy={busy}
          onCancel={() => setConfirmRegen(false)}
          onConfirm={() => {
            void run(() => acciones.regenerate(), 'Regenerando el resumen completo.').finally(() => setConfirmRegen(false))
          }}
        >
          <p>Se vuelve a leer todo el ticket desde cero con la inteligencia artificial y <strong>consume más</strong> que una actualización normal.</p>
          <p>Úsalo solo si el resumen quedó mal o quieres la plantilla nueva.</p>
        </ConfirmDialog>
      )}
    </article>
  )
}
