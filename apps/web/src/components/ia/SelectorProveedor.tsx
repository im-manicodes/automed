import { LuCpu, LuInfo } from 'react-icons/lu'
import type { HardwareIa, ProveedorIa } from '../../lib/api'
import { PROVEEDORES } from '../../lib/ia'

interface Props {
  value: ProveedorIa | null
  onChange: (p: ProveedorIa) => void
  hardware: HardwareIa | null
}

/** Tarjetas para elegir el proveedor de IA. Ollama se deshabilita si este equipo no alcanza. */
export default function SelectorProveedor({ value, onChange, hardware }: Props) {
  const ollamaBloqueado = hardware ? !hardware.ollamaApto.apto : false
  return (
    <div className="space-y-3">
      {hardware?.entorno === 'docker' && (
        <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
          <LuInfo className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
          Estos datos son del equipo donde corre la aplicación (el servidor), no del tuyo.
        </p>
      )}
      <div role="radiogroup" aria-label="Proveedor de IA" className="grid gap-3 md:grid-cols-2">
        {PROVEEDORES.map((p) => {
          const bloqueado = p.id === 'ollama' && ollamaBloqueado
          const activo = value === p.id
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={activo}
              aria-disabled={bloqueado || undefined}
              disabled={bloqueado}
              onClick={() => onChange(p.id)}
              className={`min-h-12 rounded-xl border-2 p-4 text-left ${activo ? 'border-blue-700 bg-blue-50' : 'border-slate-200 bg-white'}`}
            >
              <span className="block text-lg font-bold">{p.nombre}</span>
              <span className="block text-slate-700">{p.descripcion}</span>
              {p.id === 'ollama' && hardware && (
                <span className={`mt-2 block text-sm ${bloqueado ? 'text-red-900' : 'text-slate-700'}`}>
                  <LuCpu className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
                  {hardware.ollamaApto.motivo}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
