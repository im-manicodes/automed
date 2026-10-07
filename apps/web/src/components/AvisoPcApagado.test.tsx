import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError, api } from '../lib/api'
import { limpiarPcApagada } from '../lib/pcApagada'
import * as pc from '../lib/pcApagada'
import { mockFetch } from '../test/mockFetch'
import AvisoPcApagado from './AvisoPcApagado'

const OFF = { status: 503, body: { statusCode: 503, code: 'pc_apagada', message: 'x' } }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  act(() => limpiarPcApagada())
})

describe('aviso de computadora apagada', () => {
  it('api() traduce el código del relay y muestra el aviso con Reintentar', async () => {
    mockFetch({ 'GET /api/threads': OFF })
    render(<AvisoPcApagado />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const e = await api('/threads').catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect((e as ApiError).pcApagada).toBe(true)
    expect(await screen.findByText(/Tu computadora está apagada o sin internet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reintentar/ })).toBeInTheDocument()
  })

  it('un 503 sin código no activa el aviso', async () => {
    mockFetch({ 'GET /api/threads': { status: 503, body: { message: 'ocupado' } } })
    render(<AvisoPcApagado />)
    await api('/threads').catch(() => null)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('Reintentar: sigue apagada se queda; si responde, recarga', async () => {
    let encendida = false
    mockFetch({
      'GET /api/threads': OFF,
      'GET /api/auth/me': () => (encendida ? { body: { authenticated: false } } : OFF),
    })
    const recargar = vi.spyOn(pc, 'recargarApp').mockImplementation(() => {})
    render(<AvisoPcApagado />)
    await api('/threads').catch(() => null)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: /Reintentar/ }))
    expect(recargar).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    encendida = true
    await u.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(recargar).toHaveBeenCalled()
  })
})
