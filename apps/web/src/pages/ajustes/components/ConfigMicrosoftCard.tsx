import { useState } from 'react'
import type { AjustesMicrosoft } from '../../../lib/api'
import { useGuardarConfigMicrosoft } from '../hooks/useConfigMicrosoft'
import { errorMessage } from '../../../lib/format'
import { copiarTexto } from '../../../lib/clipboard'
import { useToast } from '../../../context/toasts-context'
import { LuCopy, LuCheck, LuKeyRound } from 'react-icons/lu'

interface Props {
  config: AjustesMicrosoft
  onSaved: () => void | Promise<void>
}

const campoCls = 'w-full rounded-xl border border-slate-300 bg-white p-3 text-base min-h-11'
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Tarjeta "Conexión con Microsoft": ID de cliente, inquilino, secreto opcional y URL de redirección. */
export default function ConfigMicrosoftCard({ config, onSaved }: Props) {
  const { toast } = useToast()
  const guardar = useGuardarConfigMicrosoft()
  const [clientId, setClientId] = useState(config.clientId)
  const [tenantId, setTenantId] = useState(config.tenantId)
  const [secreto, setSecreto] = useState('')
  const [cambiandoSecreto, setCambiandoSecreto] = useState(!config.tieneSecreto)
  const [quitarSecreto, setQuitarSecreto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const copiar = async () => {
    toast((await copiarTexto(config.redirectUriSugerida)) ? 'Dirección copiada.' : 'No se pudo copiar. Cópiala a mano.', 'ok')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!GUID.test(clientId.trim())) {
      setError('El ID de cliente es un código como 11111111-2222-3333-4444-555555555555.')
      return
    }
    const body: { clientId: string; tenantId: string; clientSecret?: string | null } = { clientId: clientId.trim(), tenantId: tenantId.trim() || 'common' }
    if (quitarSecreto) body.clientSecret = null
    else if (cambiandoSecreto && secreto.trim()) body.clientSecret = secreto.trim()
    setBusy(true)
    try {
      await guardar.mutate({ body_params: body })
      setSecreto('')
      setQuitarSecreto(false)
      setCambiandoSecreto(false)
      toast('Configuración de Microsoft guardada.', 'ok')
      await onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const secretoGuardado = config.tieneSecreto && !quitarSecreto

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-lg font-bold">Conexión con Microsoft</h3>
      <p className="text-slate-700">
        {config.configurado ? <><LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Microsoft está configurado.</> : 'Antes de conectar tu Outlook, registra esta app en Microsoft y pega aquí sus datos.'}
      </p>

      <div className="space-y-1">
        <label htmlFor="ms-client-id" className="font-semibold">ID de cliente</label>
        <input id="ms-client-id" type="text" autoComplete="off" spellCheck={false} value={clientId} onChange={(e) => setClientId(e.target.value)} className={campoCls} placeholder="11111111-2222-3333-4444-555555555555" />
      </div>

      <div className="space-y-1">
        <label htmlFor="ms-tenant" className="font-semibold">Inquilino</label>
        <input id="ms-tenant" type="text" autoComplete="off" spellCheck={false} value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={campoCls} aria-describedby="ms-tenant-h" />
        <p id="ms-tenant-h" className="text-sm text-slate-600">Déjalo en «common» si no sabes cuál usar. También puede ser «organizations», «consumers» o el código de tu organización.</p>
      </div>

      <div className="space-y-1">
        <span className="font-semibold">Secreto de cliente (opcional)</span>
        {secretoGuardado && !cambiandoSecreto && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex min-h-11 items-center rounded-xl bg-slate-50 px-3"><LuKeyRound className="mr-1.5 size-4" aria-hidden />Secreto guardado</span>
            <button type="button" className="btn btn-secondary" onClick={() => setCambiandoSecreto(true)}>Cambiar</button>
            <button type="button" className="btn btn-secondary" onClick={() => setQuitarSecreto(true)}>Quitar</button>
          </div>
        )}
        {quitarSecreto && (
          <p className="text-sm text-slate-700">
            Se quitará el secreto al guardar. <button type="button" className="underline" onClick={() => setQuitarSecreto(false)}>Deshacer</button>
          </p>
        )}
        {!quitarSecreto && cambiandoSecreto && (
          <input id="ms-secret" aria-label="Secreto de cliente" type="password" autoComplete="new-password" value={secreto} onChange={(e) => setSecreto(e.target.value)} className={campoCls} placeholder={config.tieneSecreto ? 'Escribe el secreto nuevo' : 'Solo si tu registro lo pide'} />
        )}
      </div>

      <div className="space-y-1">
        <span className="font-semibold">Dirección de redirección</span>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-50 p-2 text-sm">{config.redirectUriSugerida}</code>
          <button type="button" className="btn btn-secondary" aria-label="Copiar dirección de redirección" onClick={() => void copiar()}>
            <LuCopy className="mr-1.5 size-4" aria-hidden />Copiar
          </button>
        </div>
        <p className="text-sm text-slate-600">
          En Microsoft Entra: Registros de aplicaciones, tu app, Autenticación, «Agregar plataforma», «Web», y pega esta dirección. En Permisos de API agrega Mail.Read y User.Read (delegados).
        </p>
      </div>

      {error && <p role="alert" className="text-red-900">{error}</p>}
      <button type="submit" className="btn w-full" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
    </form>
  )
}
