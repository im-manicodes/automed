import { useSearchParams } from 'react-router-dom'
import PlantillaEditor from '../components/PlantillaEditor'
import { TIPOS_PLANTILLA, tipoPlantilla } from '../lib/plantillas'

/** Plantillas que usa la IA. La pestaña activa vive en la URL (?tipo=resumen|whatsapp). */
export default function Plantilla() {
  const [params, setParams] = useSearchParams()
  const tipo = tipoPlantilla(params.get('tipo'))

  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-bold">Plantillas</h2>
      <p className="text-slate-700">Elige qué plantilla quieres editar. La inteligencia artificial las sigue al escribir.</p>

      <div role="tablist" aria-label="Tipo de plantilla" className="flex gap-1 border-b border-slate-300">
        {TIPOS_PLANTILLA.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-plantilla-${t.id}`}
            aria-selected={tipo.id === t.id}
            aria-controls="panel-plantilla"
            onClick={() => setParams(t.id === 'resumen' ? {} : { tipo: t.id }, { replace: true })}
            className={`min-h-12 flex-1 border-b-4 px-2 font-semibold md:flex-none md:px-6 ${tipo.id === t.id ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-700'}`}
          >
            {t.etiqueta}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="panel-plantilla" aria-labelledby={`tab-plantilla-${tipo.id}`}>
        <PlantillaEditor key={tipo.id} tipo={tipo} />
      </div>
    </section>
  )
}
