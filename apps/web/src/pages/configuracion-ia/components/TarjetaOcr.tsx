import { useState } from 'react'
import { LuSave } from 'react-icons/lu'
import ConfigOcr from '../../../components/ia/ConfigOcr'
import ErrorBox from '../../../components/ErrorBox'
import Spinner from '../../../components/Spinner'
import { useToast } from '../../../context/toasts-context'
import { useAjustesOcr, useAplicarOcr } from '../../../hooks/useAjustesOcr'
import type { AjustesIa, MotorOcr } from '../../../lib/api'
import { errorMessage } from '../../../lib/format'
import { avanzadoDesde, avanzadoValido, faltaParaOcr, type AvanzadoOcr, type ClavesAws, type ClavesAzure } from '../../../lib/ocr'

interface Props {
  ajustesIa: AjustesIa
  claves: ClavesAws
  onClaves: (c: ClavesAws) => void
  /** Las claves ya se guardaron: la IA se actualiza con la respuesta. */
  onGuardadoIa: (nuevo: AjustesIa) => void
}

/** Tarjeta «Lectura de PDFs escaneados». Comparte las claves de AWS con el proveedor Bedrock. */
export default function TarjetaOcr({ ajustesIa, claves, onClaves, onGuardadoIa }: Props) {
  const { toast } = useToast()
  const ocr = useAjustesOcr()
  const { aplicar, loading } = useAplicarOcr()
  const [elegido, setElegido] = useState<MotorOcr | null>(null)
  const [azure, setAzure] = useState<ClavesAzure>({})
  const [avanzadoEditado, setAvanzadoEditado] = useState<AvanzadoOcr | null>(null)

  const motor = elegido ?? ocr.data?.motor ?? 'ninguno'
  const avanzado = avanzadoEditado ?? (ocr.data ? avanzadoDesde(ocr.data) : undefined)
  const falta = ocr.data ? faltaParaOcr(motor, ocr.data, ajustesIa, claves, azure) : null

  const guardar = async () => {
    if (!ocr.data) return
    const r = await aplicar({ motor, actual: ocr.data, claves, azure, forzar: true, avanzado })
    if (r.ia) onGuardadoIa(r.ia)
    await ocr.refetch()
    setElegido(null)
    setAzure({})
    setAvanzadoEditado(null)
  }

  const guardarYAvisar = async () => {
    try {
      await guardar()
      toast('Cambios guardados.', 'ok')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-lg font-bold">Lectura de PDFs escaneados</h3>
      {ocr.error && !ocr.data && <ErrorBox message={ocr.error} onRetry={() => void ocr.refetch()} />}
      {!ocr.data && !ocr.error && <Spinner text="Cargando…" />}
      {ocr.data && (
        <>
          <ConfigOcr
            ajustes={ocr.data}
            motor={motor}
            onMotor={setElegido}
            awsGuardada={ajustesIa.claves.aws}
            claves={claves}
            onClaves={onClaves}
            azure={azure}
            onAzure={setAzure}
            onRecheck={() => ocr.refetch()}
            antesDeProbar={guardar}
            avanzado={avanzado}
            onAvanzado={setAvanzadoEditado}
          />
          {falta && <p role="status" className="text-sm text-amber-900">{falta}</p>}
          <button type="button" className="btn w-full" disabled={loading || falta !== null || (!!avanzado && !avanzadoValido(avanzado))} onClick={() => void guardarYAvisar()}>
            <LuSave className="size-5" aria-hidden />{loading ? 'Guardando…' : 'Guardar lectura de PDFs'}
          </button>
        </>
      )}
    </section>
  )
}
