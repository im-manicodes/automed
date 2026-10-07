import { LuInfo } from 'react-icons/lu'
import type { AjustesOcr, MotorOcr } from '../../lib/api'
import type { ClavesAws } from '../../lib/ocr'
import BotonProbarOcr from './BotonProbarOcr'
import CamposAws from './CamposAws'
import PanelServicioOcr from './PanelServicioOcr'
import SelectorOcr from './SelectorOcr'

interface Props {
  ajustes: AjustesOcr
  motor: MotorOcr
  onMotor: (m: MotorOcr) => void
  /** ¿Hay claves de AWS guardadas en el servidor? */
  awsGuardada: boolean
  claves: ClavesAws
  onClaves: (c: ClavesAws) => void
  onRecheck: () => Promise<unknown> | void
  /** Guarda las claves escritas antes de probar Textract. */
  antesDeProbar?: () => Promise<unknown>
}

/** Selector de lectura de PDFs escaneados con el detalle de la opción elegida. */
export default function ConfigOcr({ ajustes, motor, onMotor, awsGuardada, claves, onClaves, onRecheck, antesDeProbar }: Props) {
  return (
    <div className="space-y-4">
      <SelectorOcr value={motor} onChange={onMotor} entorno={ajustes.entorno} />
      {motor === 'local' && ajustes.entorno.servidor && <PanelServicioOcr ajustes={ajustes} onRecheck={onRecheck} />}
      {motor === 'textract' && (
        <div className="space-y-4">
          <CamposAws guardada={awsGuardada} value={claves} onChange={onClaves} />
          <BotonProbarOcr antes={antesDeProbar} />
        </div>
      )}
      {motor === 'ninguno' && (
        <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
          <LuInfo className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Puedes elegirlo después en Ajustes. Mientras tanto, los PDF digitales se leen sin problema.
        </p>
      )}
    </div>
  )
}
