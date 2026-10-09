import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LuArrowLeft, LuCircleCheck, LuCircleX, LuPause } from 'react-icons/lu'
import ConfirmDialog from '../../components/ConfirmDialog'
import ErrorBox from '../../components/ErrorBox'
import Spinner from '../../components/Spinner'
import { useToast } from '../../context/toasts-context'
import { useDescargarRegistro, useLimpiarRegistro, useRegistroApi } from '../../hooks/useAjustesRegistro'
import { guardarArchivo } from '../../lib/descarga'
import { errorMessage, plural } from '../../lib/format'
import AccionesRegistro from './components/AccionesRegistro'
import FiltrosRegistro from './components/FiltrosRegistro'
import ListaRegistro from './components/ListaRegistro'
import { nombreArchivoRegistro, type FiltroNivel } from './lib/niveles'

export default function Registro() {
  const { toast } = useToast()
  const [nivel, setNivel] = useState<FiltroNivel>('todo')
  const [q, setQ] = useState('')
  const [pausado, setPausado] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const { lineas, loading, error, refetch, vaciar } = useRegistroApi({ nivel: nivel === 'todo' ? undefined : nivel, q }, pausado || confirmar)
  const descargar = useDescargarRegistro()
  const limpiar = useLimpiarRegistro()
  const errores = lineas.filter((l) => l.nivel === 'error').length

  const bajar = async () => {
    try {
      guardarArchivo(await descargar.mutate(), nombreArchivoRegistro())
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const borrar = async () => {
    try {
      await limpiar.mutate()
      vaciar()
      setConfirmar(false)
      toast('Registro limpio.', 'ok')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <section className="space-y-5">
      <Link to="/ajustes" className="inline-flex min-h-11 items-center gap-1 text-blue-700 underline"><LuArrowLeft className="size-4" aria-hidden />Ajustes</Link>
      <h2 className="text-2xl font-bold">Registro de la API</h2>
      <p className="text-slate-700">Lo que va haciendo el servidor. Sirve para ver qué pasó si algo falla. No muestra el contenido de tus correos y oculta claves y direcciones de correo.</p>

      <AccionesRegistro
        pausado={pausado}
        descargando={descargar.loading}
        onPausa={() => setPausado((p) => !p)}
        onDescargar={() => void bajar()}
        onLimpiar={() => setConfirmar(true)}
      />
      <FiltrosRegistro nivel={nivel} q={q} onNivel={setNivel} onBuscar={setQ} />

      {pausado && (
        <p role="status" className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-slate-800">
          <LuPause className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />En pausa: no se muestran líneas nuevas.
        </p>
      )}
      {!loading && !error && (
        <p role="status" className={`rounded-xl border p-3 ${errores > 0 ? 'border-red-300 bg-red-50 text-red-900' : 'border-green-300 bg-green-50 text-green-900'}`}>
          {errores > 0
            ? <><LuCircleX className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />{`Algo falló: ${plural(errores, 'error', 'errores')} en la lista.`}</>
            : <><LuCircleCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Todo bien: no hay errores en la lista.</>}
        </p>
      )}

      {error && lineas.length === 0 && <ErrorBox message={error} onRetry={() => void refetch()} />}
      {loading && lineas.length === 0 && <Spinner text="Cargando…" />}
      {!loading && !(error && lineas.length === 0) && <ListaRegistro lineas={lineas} />}

      {confirmar && (
        <ConfirmDialog title="¿Limpiar el registro?" confirmLabel="Limpiar" busy={limpiar.loading} onConfirm={() => void borrar()} onCancel={() => setConfirmar(false)}>
          <p>Se borran todas las líneas guardadas. Si las necesitas, descárgalas antes.</p>
        </ConfirmDialog>
      )}
    </section>
  )
}
