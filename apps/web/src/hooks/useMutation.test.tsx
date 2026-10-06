import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { callsOf, mockFetch } from '../test/mockFetch'
import { useMutation } from './useMutation'

afterEach(() => vi.unstubAllGlobals())

describe('useMutation', () => {
  it('envía el cuerpo, guarda data y llama onSuccess', async () => {
    const f = mockFetch({ 'POST /api/threads/analyze': (req) => ({ body: { recibido: req.body } }) })
    const onSuccess = vi.fn()
    const { result } = renderHook(() =>
      useMutation<{ recibido: unknown }, { ids: string[] }>({ url: '/threads/analyze', onSuccess }),
    )
    expect(result.current.loading).toBe(false)
    let r: unknown
    await act(async () => {
      r = await result.current.mutate({ body_params: { ids: ['a'] } })
    })
    expect(r).toEqual({ recibido: { ids: ['a'] } })
    expect(result.current.data).toEqual({ recibido: { ids: ['a'] } })
    expect(onSuccess).toHaveBeenCalledWith({ recibido: { ids: ['a'] } })
    expect(callsOf(f)).toEqual(['POST /api/threads/analyze'])
  })

  it('relanza el error, lo guarda y llama onError', async () => {
    mockFetch({ 'POST /api/x': { status: 409, body: { message: 'Ya existe' } } })
    const onError = vi.fn()
    const { result } = renderHook(() => useMutation({ url: '/x', onError }))
    await act(async () => {
      await expect(result.current.mutate()).rejects.toMatchObject({ name: 'ApiError', message: 'Ya existe' })
    })
    expect(result.current.error).toBe('Ya existe')
    expect(result.current.loading).toBe(false)
    expect(onError).toHaveBeenCalledWith('Ya existe')
  })

  it('arma urlParams y query_params (omite null/undefined) con el método indicado', async () => {
    const f = mockFetch({ 'DELETE /api/events/7?a=1&c=false': { body: {} } })
    const { result } = renderHook(() => useMutation({ url: '/events', method: 'DELETE' }))
    await act(async () => {
      await result.current.mutate({ urlParams: '/7', query_params: { a: 1, b: undefined, d: null, c: false } })
    })
    expect(callsOf(f)).toEqual(['DELETE /api/events/7?a=1&c=false'])
  })

  it('usa & si la url ya trae query', async () => {
    const f = mockFetch({ 'POST /api/x?k=1&z=2': { body: {} } })
    const { result } = renderHook(() => useMutation({ url: '/x?k=1' }))
    await act(async () => {
      await result.current.mutate({ query_params: { z: 2 } })
    })
    expect(callsOf(f)).toEqual(['POST /api/x?k=1&z=2'])
  })

  it('con 401 refresca sesión y reintenta', async () => {
    let n = 0
    const f = mockFetch({
      'POST /api/x': () => (++n === 1 ? { status: 401 } : { body: { ok: true } }),
      'POST /api/auth/refresh': { body: {} },
    })
    const { result } = renderHook(() => useMutation<{ ok: boolean }>({ url: '/x' }))
    await act(async () => {
      await result.current.mutate()
    })
    expect(result.current.data).toEqual({ ok: true })
    expect(callsOf(f)).toEqual(['POST /api/x', 'POST /api/auth/refresh', 'POST /api/x'])
  })

  it('blob con método no GET', async () => {
    const f = mockFetch({ 'POST /api/reports/export': { body: new Blob(['x']) } })
    const { result } = renderHook(() => useMutation<Blob>({ url: '/reports/export', responseType: 'blob' }))
    await act(async () => {
      await result.current.mutate({ body_params: {} })
    })
    expect(await result.current.data?.text()).toBe('x')
    expect(callsOf(f)).toEqual(['POST /api/reports/export'])
  })
})
