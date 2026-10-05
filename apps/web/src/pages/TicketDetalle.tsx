import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AttachmentRow from '../components/AttachmentRow'
import ConfirmDialog from '../components/ConfirmDialog'
import ErrorBox from '../components/ErrorBox'
import Markdown from '../components/Markdown'
import Spinner from '../components/Spinner'
import StatusBadge from '../components/StatusBadge'
import Switch from '../components/Switch'
import VersionHistory from '../components/VersionHistory'
import { useToast } from '../context/toasts'
import { threadsApi, type SynthesisResponse, type ThreadDetail } from '../lib/api'
import { errorMessage, formatDate, plural, slugify } from '../lib/format'
import { canAnalyze, isBusy } from '../lib/status'
import { usePolling } from '../lib/usePolling'

type Tab = 'resumen' | 'correos' | 'adjuntos'
const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'correos', label: 'Correos' },
  { id: 'adjuntos', label: 'Adjuntos' },
]

export default function TicketDetalle() {
  const { id = '' } = useParams()
  const { toast } = useToast()
  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [synth, setSynth] = useState<SynthesisResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('resumen')
  const [busy, setBusy] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)

  const load = useCallback(
    async (silent = false) => {
      try {
        const [t, s] = await Promise.all([threadsApi.get(id), threadsApi.synthesis(id)])
        setThread(t)
        setSynth(s)
        setError(null)
      } catch (e) {
        if (!silent) setError(errorMessage(e))
      }
    },
    [id],
  )

  useEffect(() => {
    void load()
  }, [load])

  usePolling(() => void load(true), 5000, !!thread && isBusy(thread.status))

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true)
    try {
      await fn()
      toast(okMsg, 'ok')
      await load(true)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <ErrorBox message={error} onRetry={() => void load()} />
  if (!thread || !synth) return <Spinner text="Cargando el ticket…" />

  const latest = synth.latest
  const analyzable = canAnalyze(thread)
  const analyzed = thread.status === 'listo' || thread.status === 'necesita_revision'
  const analyzeLabel =
    thread.status === 'error' ? 'Reintentar análisis' : thread.tieneMensajesNuevos && analyzed ? 'Actualizar resumen' : 'Analizar este ticket'
  const attachmentCount = thread.messages.reduce((n, m) => n + m.attachments.length, 0)

  const copy = async () => {
    if (!latest) return
    try {
      await navigator.clipboard.writeText(latest.markdown)
      toast('Resumen copiado.', 'ok')
    } catch {
      toast('No se pudo copiar. Prueba con “Descargar”.', 'error')
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
      <Link to="/tickets" className="inline-flex min-h-11 items-center text-blue-800 underline">← Volver a los tickets</Link>
      <h2 className="break-words text-2xl font-bold">{thread.subject || '(Sin asunto)'}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={thread.status} />
        <span className="text-sm text-slate-700">{plural(thread.messages.length, 'correo', 'correos')} · {plural(attachmentCount, 'PDF', 'PDF')}</span>
      </div>

      {isBusy(thread.status) && (
        <p role="status" className="rounded-xl border border-blue-300 bg-blue-50 p-3 text-blue-900">
          <span aria-hidden>⏳ </span>Estamos analizando este ticket. Se actualiza solo; puedes salir y volver luego.
        </p>
      )}
      {thread.status === 'error' && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">
          <span aria-hidden>⚠ </span>El análisis no pudo terminar. Puedes intentarlo otra vez.
        </p>
      )}
      {thread.tieneMensajesNuevos && (
        <p className="rounded-xl border border-violet-300 bg-violet-50 p-3 text-violet-900">
          <span aria-hidden>✉ </span>Llegaron mensajes nuevos que aún no están en el resumen.
        </p>
      )}

      {analyzable && (
        <div className="space-y-1">
          <button type="button" className="btn w-full" disabled={busy} onClick={() => void run(() => threadsApi.analyze(id), 'Analizando. Esto puede tardar unos minutos.')}>
            {analyzeLabel}
          </button>
          <p className="text-sm text-slate-700">Usa inteligencia artificial. Si ya hay resumen, solo se lee lo nuevo.</p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <Switch
          label="Seguimiento automático"
          checked={thread.seguimiento}
          disabled={busy}
          onChange={(v) => void run(() => threadsApi.setSeguimiento(id, v), v ? 'Seguimiento activado.' : 'Seguimiento apagado.')}
        />
        <p className="text-sm text-slate-700">
          Si lo activas, cuando llegue un mensaje nuevo a este ticket el resumen se actualiza solo (usa inteligencia artificial). Apagado, solo te avisamos.
        </p>
      </div>

      {synth.plantillaDesactualizada && (
        <div className="space-y-2 rounded-xl border border-amber-400 bg-amber-50 p-3 text-amber-900">
          <p><span aria-hidden>📝 </span>La plantilla cambió después de escribir este resumen. Las actualizaciones siguen con la plantilla anterior.</p>
          <button type="button" className="btn btn-secondary" disabled={busy || isBusy(thread.status)} onClick={() => setConfirmRegen(true)}>
            Regenerar con la plantilla nueva
          </button>
        </div>
      )}

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
            className={`min-h-12 flex-1 border-b-4 px-2 font-semibold ${tab === t.id ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-700'}`}
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
                <button type="button" className="btn btn-secondary flex-1" onClick={() => void copy()}>📋 Copiar resumen</button>
                <button type="button" className="btn btn-secondary flex-1" onClick={download}>⬇ Descargar .md</button>
              </div>
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
                  <span aria-hidden>{m.isFromMe ? '↗ ' : '↙ '}</span>{m.isFromMe ? 'Enviado por mí' : 'Recibido'}
                </span>
                <span className="text-sm text-slate-700">{formatDate(m.receivedAt)}</span>
              </div>
              <p className="break-all text-sm text-slate-800">De: {m.from}</p>
              <details>
                <summary className="min-h-11 cursor-pointer py-2 font-medium">Ver el mensaje</summary>
                <p className="whitespace-pre-wrap break-words text-base">{m.bodyText || '(Sin texto)'}</p>
              </details>
              {m.attachments.length > 0 && <p className="text-sm text-slate-700">📎 {plural(m.attachments.length, 'archivo adjunto', 'archivos adjuntos')}</p>}
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

      {confirmRegen && (
        <ConfirmDialog
          title="¿Regenerar el resumen completo?"
          confirmLabel="Sí, regenerar"
          busy={busy}
          onCancel={() => setConfirmRegen(false)}
          onConfirm={() => {
            void run(() => threadsApi.regenerate(id), 'Regenerando el resumen completo.').finally(() => setConfirmRegen(false))
          }}
        >
          <p>Se vuelve a leer todo el ticket desde cero con la inteligencia artificial y <strong>consume más</strong> que una actualización normal.</p>
          <p>Úsalo solo si el resumen quedó mal o quieres la plantilla nueva.</p>
        </ConfirmDialog>
      )}
    </article>
  )
}
