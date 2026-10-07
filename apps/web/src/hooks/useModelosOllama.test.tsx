import { act, renderHook, waitFor } from '@testing-library/react'
import type { HardwareIa } from '../lib/api'
import { hardwareIa, hardwareSinModelo, hardwareSinOllama } from '../test/ajustesIa'
import { callsOf, mockFetch } from '../test/mockFetch'
import { useModelosOllama } from './useModelosOllama'

const M = 'qwen3-vl:4b-instruct'
const POST = 'POST /api/settings/ia/ollama/pull'
const GET = `GET /api/settings/ia/ollama/pull?modelo=${encodeURIComponent(M)}`
const GB = 1024 ** 3

function montar(hardware: HardwareIa | null, modelos: string[] = [M], activo = true) {
  const onRecheck = vi.fn()
  const r = renderHook((p: { hardware: HardwareIa | null; activo: boolean }) => useModelosOllama({ activo: p.activo, hardware: p.hardware, modelos, onRecheck }), {
    initialProps: { hardware, activo },
  })
  return { ...r, onRecheck }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useModelosOllama', () => {
  it('descarga sola el modelo que falta y pide refrescar al terminar', async () => {
    let n = 0
    const f = mockFetch({
      [POST]: { status: 202, body: { modelo: M, estado: 'descargando' } },
      [GET]: () => (++n < 2 ? { body: { modelo: M, estado: 'descargando', completado: GB, total: 3 * GB } } : { body: { modelo: M, estado: 'listo', completado: 3 * GB, total: 3 * GB } }),
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result, onRecheck, rerender } = montar(hardwareSinModelo())
    await waitFor(() => expect(result.current.estados[M]?.estado).toBe('descargando'))
    expect(callsOf(f).filter((c) => c === POST)).toHaveLength(1)
    expect(result.current.listo).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(1600))
    await waitFor(() => expect(result.current.estados[M]?.estado).toBe('listo'))
    expect(onRecheck).toHaveBeenCalled()
    rerender({ hardware: hardwareSinModelo([M]), activo: true })
    expect(result.current.listo).toBe(true)
    expect(callsOf(f).filter((c) => c === POST)).toHaveLength(1)
  })

  it('si el servidor olvida la descarga (inactivo) la trata como interrumpida y permite reintentar', async () => {
    const f = mockFetch({
      [POST]: { status: 202, body: { modelo: M, estado: 'descargando' } },
      [GET]: { body: { modelo: M, estado: 'inactivo', completado: 0, total: 0 } },
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = montar(hardwareSinModelo())
    await waitFor(() => expect(callsOf(f).filter((c) => c === POST)).toHaveLength(1))
    await act(() => vi.advanceTimersByTimeAsync(1600))
    await waitFor(() => expect(result.current.estados[M]?.estado).toBe('error'))
    expect(result.current.estados[M]?.error).toMatch(/interrumpi/)
    expect(result.current.listo).toBe(false)
    expect(callsOf(f).filter((c) => c === POST)).toHaveLength(1)
    act(() => result.current.reintentar(M))
    await waitFor(() => expect(callsOf(f).filter((c) => c === POST)).toHaveLength(2))
  })

  it('modelo ya instalado, con o sin :latest: ninguna petición y listo', () => {
    const f = mockFetch({})
    const a = montar(hardwareIa())
    expect(a.result.current.listo).toBe(true)
    const b = montar(hardwareSinModelo([`${M}:latest`]))
    expect(b.result.current.listo).toBe(true)
    expect(f).not.toHaveBeenCalled()
  })

  it('Ollama desactualizado: no inicia nada', async () => {
    const f = mockFetch({})
    const hw = hardwareIa({ ollama: { alcanzable: true, version: '0.11.4', modelos: [], versionMinima: '0.12.7', requiereActualizar: true } })
    const { result } = montar(hw)
    await act(() => Promise.resolve())
    expect(result.current.desactualizado).toBe(true)
    expect(result.current.listo).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  it('Ollama no alcanzable: sondea cada 3 s y arranca sola al aparecer', async () => {
    const f = mockFetch({ [POST]: { status: 202, body: {} }, [GET]: { body: { modelo: M, estado: 'descargando', completado: 0, total: 10 } } })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result, onRecheck, rerender } = montar(hardwareSinOllama())
    expect(result.current.buscando).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(3100))
    expect(onRecheck).toHaveBeenCalledTimes(1)
    expect(callsOf(f)).not.toContain(POST)
    rerender({ hardware: hardwareSinModelo(), activo: true })
    await waitFor(() => expect(callsOf(f)).toContain(POST))
    const llamadas = onRecheck.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(3100))
    expect(onRecheck.mock.calls.length).toBe(llamadas)
  })

  it('error: no reintenta solo; reintentar vuelve a enviar el POST', async () => {
    let fallar = true
    const f = mockFetch({
      [POST]: () => (fallar ? { status: 500, body: { message: 'sin disco' } } : { status: 202, body: {} }),
      [GET]: { body: { modelo: M, estado: 'descargando', completado: 0, total: 10 } },
    })
    const { result } = montar(hardwareSinModelo())
    await waitFor(() => expect(result.current.estados[M]?.estado).toBe('error'))
    expect(callsOf(f).filter((c) => c === POST)).toHaveLength(1)
    fallar = false
    act(() => result.current.reintentar(M))
    await waitFor(() => expect(callsOf(f).filter((c) => c === POST)).toHaveLength(2))
    await waitFor(() => expect(result.current.estados[M]?.estado).toBe('descargando'))
  })

  it('inactivo: no hace ninguna petición ni sondeo', async () => {
    const f = mockFetch({})
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result, onRecheck } = montar(hardwareSinOllama(), [M], false)
    montar(hardwareSinModelo(), [M], false)
    await act(() => vi.advanceTimersByTimeAsync(7000))
    expect(f).not.toHaveBeenCalled()
    expect(onRecheck).not.toHaveBeenCalled()
    expect(result.current.listo).toBe(false)
  })
})
