import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LuArrowLeft, LuCheck, LuMonitor, LuSmartphone, LuTriangleAlert } from 'react-icons/lu'
import ConfirmDialog from '../../components/ConfirmDialog'
import Switch from '../../components/Switch'
import ErrorBox from '../../components/ErrorBox'
import Spinner from '../../components/Spinner'
import { useToast } from '../../context/toasts-context'
import { usePolling } from '../../hooks/usePolling'
import { errorMessage } from '../../lib/format'
import CodigoQr from './components/CodigoQr'
import { useActivarRelay, useDesvincularRelay, useMantenerDespierto, useRelayEstado } from './hooks/useRelay'
import type { EstadoRelay } from './hooks/useRelay'

const TEXTO_ESTADO: Record<EstadoRelay, string> = {
  conectado: 'Conectado. Ya puedes entrar desde tu celular.',
  conectando: 'Conectando…',
  desconectado: 'Desconectado. Reintentando conectar…',
  rechazado: 'El servicio no aceptó este equipo. Desvincula y vuelve a activar.',
}

export default function UsarCelular() {
  const { toast } = useToast()
  const { data, error, refetch } = useRelayEstado()
  const activar = useActivarRelay()
  const desvincular = useDesvincularRelay()
  const despierto = useMantenerDespierto()
  const [confirmando, setConfirmando] = useState(false)

  // Mientras está activo, se refresca el estado (Conectado / Desconectado).
  usePolling(() => void refetch(), 4000, !!data?.activo)

  const activarAhora = async () => {
    try {
      await activar.mutate()
      await refetch()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const cambiarDespierto = async (activo: boolean) => {
    try {
      await despierto.mutate({ body_params: { activo } })
      toast(activo ? 'Listo. Tu computadora no se suspenderá mientras el celular esté activo.' : 'Listo. Tu computadora podrá suspenderse.', 'ok')
      await refetch()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const desvincularAhora = async () => {
    try {
      await desvincular.mutate()
      setConfirmando(false)
      toast('Listo. El celular ya no puede entrar.', 'ok')
      await refetch()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <section className="space-y-5">
      <Link to="/ajustes" className="inline-flex min-h-11 items-center gap-1 text-blue-700 underline">
        <LuArrowLeft className="size-4" aria-hidden />Ajustes
      </Link>
      <h2 className="text-2xl font-bold">Usar desde el celular</h2>

      {error && !data && <ErrorBox message={error} onRetry={() => void refetch()} />}
      {!error && !data && <Spinner text="Cargando…" />}

      {data && !data.disponible && (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-slate-700">
          Esto solo funciona en la aplicación de escritorio de auto-med.
        </p>
      )}

      {data?.disponible && !data.configurado && (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
          Esta versión de la app todavía no trae el servicio para usar el celular.
        </p>
      )}

      {data?.disponible && data.configurado && !data.activo && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-slate-700">
            Entra a auto-med desde tu celular, aunque no estés en la misma red. Tu computadora debe estar encendida con la app abierta.
          </p>
          <button type="button" className="btn w-full" disabled={activar.loading} onClick={() => void activarAhora()}>
            <LuSmartphone className="size-5" aria-hidden />
            {activar.loading ? 'Activando…' : 'Activar'}
          </button>
        </div>
      )}

      {data?.disponible && data.activo && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <p
            role="status"
            className={`rounded-lg p-3 ${data.estado === 'conectado' ? 'bg-green-50 text-green-900' : 'bg-slate-50 text-slate-800'}`}
          >
            {data.estado === 'conectado' && <LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />}
            {TEXTO_ESTADO[data.estado]}
          </p>
          {data.url && (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-slate-700">
                <li>Abre la cámara de tu celular y apunta a este código.</li>
                <li>Abre la página y elige «Instalar» o «Añadir a pantalla de inicio».</li>
                <li>Entra con tu correo y contraseña de siempre.</li>
              </ol>
              <CodigoQr texto={data.urlQr ?? data.url} alt="Código QR para abrir auto-med en el celular" />
              <p className="break-all text-center text-sm text-slate-600">{data.url}</p>
              <p className="text-sm text-slate-600">
                Tu información viaja cifrada: ni siquiera el servicio intermedio puede leerla. El código contiene la clave, no lo compartas. Todos los celulares que lo escaneen comparten el acceso; «Desvincular» los saca a todos.
              </p>
            </>
          )}
          {data.arranque?.estado === 'distinto' && (
            <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
              El servicio intermedio está mostrando una versión distinta de la pantalla de arranque. Puede ser una actualización del servicio o un problema de seguridad. No escanees códigos nuevos hasta confirmarlo.
            </p>
          )}
          {data.arranque && (
            <details className="text-sm text-slate-600">
              <summary className="min-h-11 cursor-pointer py-2">Comprobar el servicio</summary>
              <p>
                {data.arranque.estado === 'ok' && 'Tu computadora comprobó que el servicio muestra la pantalla de arranque esperada. '}
                La huella esperada del arranque es:
              </p>
              <p className="break-all font-mono text-xs">{data.arranque.sha256}</p>
              <p>Puedes compararla con la que publica el proyecto en docs/relay-e2e.md.</p>
            </details>
          )}
          <button type="button" className="btn btn-secondary w-full" onClick={() => setConfirmando(true)}>
            Desvincular
          </button>
        </div>
      )}

      {data?.disponible && data.configurado && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <Switch
            label="Mantener la computadora despierta"
            checked={!!data.mantenerDespierto}
            disabled={despierto.loading}
            onChange={(v) => void cambiarDespierto(v)}
          />
          <p className="flex items-start gap-2 text-sm text-slate-600">
            <LuMonitor className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Evita que tu computadora se suspenda por inactividad mientras el celular esté activo, para poder entrar desde la calle. Gasta más batería. No funciona si cierras la tapa o la apagas.
            </span>
          </p>
        </div>
      )}

      {confirmando && (
        <ConfirmDialog
          title="¿Desvincular el celular?"
          confirmLabel="Sí, desvincular"
          busy={desvincular.loading}
          onConfirm={() => void desvincularAhora()}
          onCancel={() => setConfirmando(false)}
        >
          <p>El código y la dirección actuales dejarán de funcionar.</p>
          <p>Para volver a usar el celular tendrás que activar de nuevo y escanear un código nuevo.</p>
        </ConfirmDialog>
      )}
    </section>
  )
}
