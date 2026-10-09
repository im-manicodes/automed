import { LuInfo } from 'react-icons/lu'
import type { AjustesIa, HardwareIa } from '../../lib/api'
import type { BorradorIa } from '../../lib/ia'
import BotonProbar from './BotonProbar'
import CamposAws from './CamposAws'
import CampoClave from './CampoClave'
import PanelOllama from './PanelOllama'

interface Props {
  ajustes: AjustesIa
  borrador: BorradorIa
  onChange: (b: BorradorIa) => void
  hardware: HardwareIa | null
  onRecheck: () => Promise<unknown> | void
  /** Avisa si Ollama y sus modelos están listos (solo con Ollama elegido). */
  onOllamaListo?: (listo: boolean) => void
}

/** Credenciales o instalación según el proveedor elegido, con botón de prueba. */
export default function CredencialesProveedor({ ajustes, borrador, onChange, hardware, onRecheck, onOllamaListo }: Props) {
  const p = borrador.proveedor
  const modelo = borrador.modelos.resumen
  return (
    <div className="space-y-4">
      {p === 'openai' && (
        <CampoClave label="Clave de OpenAI" guardada={ajustes.claves.openai} value={borrador.claveOpenai} onChange={(v) => onChange({ ...borrador, claveOpenai: v })} />
      )}
      {p === 'anthropic' && (
        <CampoClave label="Clave de Anthropic" guardada={ajustes.claves.anthropic} value={borrador.claveAnthropic} onChange={(v) => onChange({ ...borrador, claveAnthropic: v })} />
      )}
      {p === 'foundry' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="foundry-endpoint" className="block font-semibold">Endpoint de Foundry</label>
            <input id="foundry-endpoint" type="url" inputMode="url" placeholder="https://mi-recurso.openai.azure.com/openai/v1" className="min-h-12 w-full rounded-xl border border-slate-300 px-3" value={borrador.foundryEndpoint} onChange={(e) => onChange({ ...borrador, foundryEndpoint: e.target.value })} />
            <p className="text-sm text-slate-600">Copia el Endpoint de tu recurso en el portal de Foundry; termina en /openai/v1.</p>
          </div>
          <CampoClave label="Clave de Foundry" guardada={ajustes.claves.foundry} value={borrador.claveFoundry} onChange={(v) => onChange({ ...borrador, claveFoundry: v })} />
        </div>
      )}
      {p === 'ollama' && (
        <PanelOllama hardware={hardware} onRecheck={onRecheck} modelos={Object.values(borrador.modelos)} onListoChange={onOllamaListo} />
      )}
      {p === 'bedrock' && (
        <div className="space-y-2">
          <label htmlFor="aws-region" className="block font-semibold">Región de AWS</label>
          <input id="aws-region" type="text" className="min-h-12 w-full rounded-xl border border-slate-300 px-3" value={borrador.awsRegion} onChange={(e) => onChange({ ...borrador, awsRegion: e.target.value })} />
          <CamposAws guardada={ajustes.claves.aws} value={borrador.aws ?? {}} onChange={(aws) => onChange({ ...borrador, aws })} />
          <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
            <LuInfo className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Si quien administra el servidor ya configuró las credenciales de AWS, puedes dejar estos campos vacíos.
          </p>
        </div>
      )}
      <BotonProbar
        borrador={{
          proveedor: p,
          modelo,
          ollamaUrl: borrador.ollamaUrl,
          awsRegion: borrador.awsRegion,
          ...(p === 'foundry' && borrador.foundryEndpoint.trim() ? { foundryEndpoint: borrador.foundryEndpoint.trim() } : {}),
          ...(typeof borrador.claveFoundry === 'string' && borrador.claveFoundry ? { claveFoundry: borrador.claveFoundry } : {}),
          ...(typeof borrador.claveOpenai === 'string' && borrador.claveOpenai ? { claveOpenai: borrador.claveOpenai } : {}),
          ...(typeof borrador.claveAnthropic === 'string' && borrador.claveAnthropic ? { claveAnthropic: borrador.claveAnthropic } : {}),
        }}
      />
    </div>
  )
}
