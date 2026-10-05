import { useState } from 'react'
import { mailApi, type MailStatus } from '../lib/api'
import { errorMessage, formatDate } from '../lib/format'
import { useToast } from '../context/toasts-context'
import ConectarOutlookButton from './ConectarOutlookButton'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  mail: MailStatus
  onChanged: () => void | Promise<void>
}

/** Tarjeta "Tu correo de Outlook": no conectado, conectado o con error. */
export default function OutlookCard({ mail, onChanged }: Props) {
  const { toast } = useToast()
  const [syncing, setSyncing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const sync = async () => {
    setSyncing(true)
    try {
      const r = await mailApi.sync()
      toast(!r.started ? 'Ya se está sincronizando. Espera un momento.' : r.error ? 'No se pudo sincronizar el correo.' : 'Correo sincronizado.', !r.started ? 'info' : r.error ? 'error' : 'ok')
      await onChanged()
    } catch (e) {
      toast(errorMessage(e), 'error')
      await onChanged()
    } finally {
      setSyncing(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await mailApi.disconnect()
      toast('Outlook desconectado. Tus tickets siguen aquí.', 'ok')
      setConfirming(false)
      await onChanged()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-lg font-bold">Tu correo de Outlook</h3>

      {!mail.connected && (
        <>
          <p className="text-slate-700">Conecta tu Outlook de la empresa para traer tus correos y convertirlos en tickets.</p>
          <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
            <span aria-hidden>🔒 </span>Solo pedimos permiso para <strong>leer</strong> tus correos. No enviamos, borramos ni cambiamos nada en tu buzón.
          </p>
          <ConectarOutlookButton />
        </>
      )}

      {mail.connected && mail.error && (
        <>
          <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">
            <span aria-hidden>⚠ </span>Hay un problema con tu Outlook{mail.email ? ` (${mail.email})` : ''}: {mail.error}
          </p>
          <p className="text-slate-700">Vuelve a conectarlo para seguir trayendo tus correos.</p>
          <ConectarOutlookButton label="Reconectar" />
        </>
      )}

      {mail.connected && !mail.error && (
        <>
          <p className="break-all">✓ Conectado: <strong>{mail.email}</strong></p>
          <p className="text-slate-700">
            {mail.syncing
              ? '⏳ Sincronizando ahora…'
              : mail.lastSyncAt
                ? `Última sincronización: ${formatDate(mail.lastSyncAt)}.`
                : 'Todavía no se ha sincronizado.'}
          </p>
          <button type="button" className="btn w-full" disabled={syncing || mail.syncing} onClick={() => void sync()}>
            {syncing || mail.syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
          <button type="button" className="btn btn-secondary w-full" onClick={() => setConfirming(true)}>Desconectar</button>
        </>
      )}

      {mail.connected && mail.error && (
        <button type="button" className="btn btn-secondary w-full" onClick={() => setConfirming(true)}>Desconectar</button>
      )}

      {confirming && (
        <ConfirmDialog title="¿Desconectar tu Outlook?" confirmLabel="Sí, desconectar" busy={busy} onConfirm={() => void disconnect()} onCancel={() => setConfirming(false)}>
          <p>Dejaremos de traer correos nuevos.</p>
          <p><strong>Tus tickets y resúmenes se conservan.</strong> Puedes volver a conectar cuando quieras.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
