import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HardwareIa } from '../lib/api'
import { errorMessage } from '../lib/format'
import { useIniciarDescargaModelo, useProgresoDescarga } from './useAjustesIa'
import { usePolling } from './usePolling'

/** Un modelo está instalado si coincide el nombre o con el sufijo `:latest`. */
export const instalado = (hw: HardwareIa, modelo: string) =>
  hw.ollama.modelos.some((m) => m === modelo || m === `${modelo}:latest`)

export interface EstadoModelo {
  estado: 'descargando' | 'listo' | 'error' | 'inactivo'
  completado: number
  total: number
  error?: string
}

interface Entrada {
  activo: boolean
  hardware: HardwareIa | null
  modelos: string[]
  onRecheck: () => Promise<unknown> | void
}

/**
 * Detecta Ollama sola (sondeo cada 3 s) y descarga uno a uno los modelos que falten,
 * sin que el usuario pulse nada. Con `activo` en false no hace ninguna petición.
 */
export function useModelosOllama({ activo, hardware, modelos, onRecheck }: Entrada) {
  const alcanzable = !!hardware?.ollama.alcanzable
  const desactualizado = alcanzable && !!hardware?.ollama.requiereActualizar
  const [estados, setEstados] = useState<Record<string, EstadoModelo>>({})
  const [actual, setActual] = useState<string | null>(null)
  const iniciados = useRef(new Set<string>())
  const arrancando = useRef(false)
  const actualRef = useRef<string | null>(null)
  const recheckRef = useRef(onRecheck)
  useEffect(() => {
    recheckRef.current = onRecheck
    actualRef.current = actual
  })
  const { mutate } = useIniciarDescargaModelo()

  const unicos = useMemo(() => [...new Set(modelos.filter(Boolean))], [modelos])
  const claveFaltan = hardware && alcanzable ? unicos.filter((m) => !instalado(hardware, m)).join('\n') : ''
  const faltan = useMemo(() => (claveFaltan ? claveFaltan.split('\n') : []), [claveFaltan])
  const todosInstalados = !!hardware && alcanzable && unicos.every((m) => instalado(hardware, m))

  // (a) Ollama no responde: volver a mirar cada 3 s hasta que aparezca.
  usePolling(() => void recheckRef.current(), 3000, activo && !!hardware && !alcanzable)

  const { refetch } = useProgresoDescarga(actual ?? '', activo && actual !== null, {
    onSuccess: (d) => {
      if (d.modelo !== actualRef.current) return
      if (d.estado !== 'inactivo') {
        setEstados((e) => ({ ...e, [d.modelo]: { estado: d.estado, completado: d.completado, total: d.total, error: d.error } }))
      }
      if (d.estado === 'listo') {
        setActual(null)
        void recheckRef.current()
      } else if (d.estado === 'inactivo') {
        // El servidor ya no recuerda la descarga (p. ej. la app se reinició a la mitad): se trata como
        // interrumpida para ofrecer «Reintentar»; si no, el modelo quedaría sin instalar y sin salida.
        setEstados((e) => ({
          ...e,
          [d.modelo]: { estado: 'error', completado: 0, total: 0, error: 'La descarga se interrumpió. Pulsa Reintentar.' },
        }))
        setActual(null)
      } else if (d.estado === 'error') {
        setActual(null)
      }
    },
  })
  usePolling(() => void refetch(), 1500, activo && actual !== null)

  // (c) Inicia, de a uno y una sola vez por modelo, los que falten.
  useEffect(() => {
    if (!activo || !alcanzable || desactualizado || actual !== null || arrancando.current) return
    const siguiente = faltan.find((m) => !iniciados.current.has(m))
    if (!siguiente) return
    iniciados.current.add(siguiente)
    arrancando.current = true
    void (async () => {
      try {
        await mutate({ body_params: { modelo: siguiente } })
        setEstados((e) => ({ ...e, [siguiente]: { estado: 'descargando', completado: 0, total: 0 } }))
        setActual(siguiente)
      } catch (e) {
        setEstados((s) => ({ ...s, [siguiente]: { estado: 'error', completado: 0, total: 0, error: errorMessage(e) } }))
      } finally {
        arrancando.current = false
      }
    })()
  }, [activo, alcanzable, desactualizado, actual, faltan, estados, mutate])

  const reintentar = useCallback((modelo: string) => {
    iniciados.current.delete(modelo)
    setEstados((e) => {
      const { [modelo]: _quitado, ...resto } = e
      return resto
    })
  }, [])

  return {
    estados: activo ? estados : {},
    listo: activo && todosInstalados && !desactualizado,
    buscando: activo && (!hardware || !alcanzable),
    desactualizado: activo && desactualizado,
    reintentar,
  }
}
