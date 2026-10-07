import { LuMonitorOff, LuRefreshCw } from 'react-icons/lu'
import { useMutation } from '../hooks/useMutation'
import { limpiarPcApagada, MENSAJE_PC_APAGADA, recargarApp, usePcApagada } from '../lib/pcApagada'

/**
 * Pantalla completa cuando el relay avisa que la computadora no responde (solo al entrar por el celular).
 * «Reintentar» pregunta por /auth/me (vía useMutation); si ya responde, recarga la app.
 */
export default function AvisoPcApagado() {
  const apagada = usePcApagada()
  const { mutate, loading } = useMutation<unknown>({ url: '/auth/me', method: 'GET' })
  if (!apagada) return null

  const reintentar = async () => {
    try {
      await mutate()
      limpiarPcApagada()
      recargarApp()
    } catch {
      // sigue apagada: api() vuelve a marcar el aviso
    }
  }

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="pc-apagada-titulo" className="fixed inset-0 z-50 flex items-center justify-center bg-white p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <LuMonitorOff className="mx-auto size-12 text-slate-500" aria-hidden />
        <h2 id="pc-apagada-titulo" className="text-xl font-bold">Sin conexión con tu computadora</h2>
        <p className="text-slate-700">{MENSAJE_PC_APAGADA}</p>
        <button type="button" className="btn w-full" disabled={loading} onClick={() => void reintentar()}>
          <LuRefreshCw className="size-5" aria-hidden />
          {loading ? 'Probando…' : 'Reintentar'}
        </button>
      </div>
    </div>
  )
}
