import { StrictMode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { callsOf, mockFetch } from '../test/mockFetch'
import { useQuery } from './useQuery'

afterEach(() => vi.unstubAllGlobals())

describe('useQuery', () => {
  it('carga datos y llama onSuccess; loading inicia en true', async () => {
    mockFetch({ 'GET /api/threads': { body: [{ id: 'a' }] } })
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useQuery<{ id: string }[]>({ url: '/threads', onSuccess }))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual([{ id: 'a' }])
    expect(onSuccess).toHaveBeenCalledWith([{ id: 'a' }])
  })

  it('guarda el mensaje del error, llama onError y no relanza', async () => {
    mockFetch({ 'GET /api/threads': { status: 400, body: { message: 'Algo salió mal' } } })
    const onError = vi.fn()
    const { result } = renderHook(() => useQuery({ url: '/threads', onError }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Algo salió mal')
    expect(result.current.data).toBeNull()
    expect(onError).toHaveBeenCalledWith('Algo salió mal')
  })

  it('enabled=false no pide nada y loading inicia en false; refetch fuerza la petición', async () => {
    const f = mockFetch({ 'GET /api/threads': { body: ['x'] } })
    const { result } = renderHook(() => useQuery<string[]>({ url: '/threads', enabled: false }))
    expect(result.current.loading).toBe(false)
    expect(f).not.toHaveBeenCalled()
    let r: string[] | null = null
    await act(async () => {
      r = await result.current.refetch()
    })
    expect(r).toEqual(['x'])
    expect(result.current.data).toEqual(['x'])
  })

  it('refetch con datos ya cargados no enciende loading', async () => {
    let n = 0
    mockFetch({ 'GET /api/threads': () => ({ body: [++n] }) })
    const { result } = renderHook(() => useQuery<number[]>({ url: '/threads' }))
    await waitFor(() => expect(result.current.data).toEqual([1]))
    const vistos: boolean[] = []
    let p: Promise<unknown> = Promise.resolve()
    act(() => {
      p = result.current.refetch()
    })
    vistos.push(result.current.loading)
    await act(async () => {
      await p
    })
    vistos.push(result.current.loading)
    expect(vistos).toEqual([false, false])
    expect(result.current.data).toEqual([2])
  })

  it('con 401 llama a /auth/refresh y reintenta', async () => {
    let intento = 0
    const f = mockFetch({
      'GET /api/threads': () => (++intento === 1 ? { status: 401 } : { body: ['ok'] }),
      'POST /api/auth/refresh': { body: {} },
    })
    const { result } = renderHook(() => useQuery<string[]>({ url: '/threads' }))
    await waitFor(() => expect(result.current.data).toEqual(['ok']))
    expect(callsOf(f)).toEqual(['GET /api/threads', 'POST /api/auth/refresh', 'GET /api/threads'])
  })

  it('ignora respuestas obsoletas cuando cambia la url', async () => {
    let soltarA: () => void = () => {}
    mockFetch({
      'GET /api/a': () => new Promise((res) => (soltarA = () => res({ body: 'A' }))),
      'GET /api/b': { body: 'B' },
    })
    const { result, rerender } = renderHook(({ url }) => useQuery<string>({ url }), {
      initialProps: { url: '/a' },
    })
    rerender({ url: '/b' })
    await waitFor(() => expect(result.current.data).toBe('B'))
    await act(async () => soltarA())
    expect(result.current.data).toBe('B')
  })

  it('en StrictMode no duplica la petición', async () => {
    const f = mockFetch({ 'GET /api/threads': { body: ['x'] } })
    const { result } = renderHook(() => useQuery<string[]>({ url: '/threads' }), { wrapper: StrictMode })
    await waitFor(() => expect(result.current.data).toEqual(['x']))
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('responseType blob usa apiBlob', async () => {
    mockFetch({ 'GET /api/reports/1/download': { body: new Blob(['hola']) } })
    const { result } = renderHook(() => useQuery<Blob>({ url: '/reports/1/download', responseType: 'blob' }))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(await result.current.data?.text()).toBe('hola')
  })
})
