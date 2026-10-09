import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../../context/toasts'
import type { AjustesMicrosoft } from '../../../lib/api'
import * as clipboard from '../../../lib/clipboard'
import { callsOf, mockFetch } from '../../../test/mockFetch'
import ConfigMicrosoftCard from './ConfigMicrosoftCard'

const GUID = '11111111-2222-3333-4444-555555555555'
const base: AjustesMicrosoft = {
  configurado: false,
  clientId: '',
  tenantId: 'common',
  tieneSecreto: false,
  redirectUri: 'http://app/api/auth/callback',
  redirectUriSugerida: 'http://app/api/auth/callback',
}

function renderCard(config: AjustesMicrosoft = base, onSaved = vi.fn()) {
  render(
    <MemoryRouter>
      <ToastProvider>
        <ConfigMicrosoftCard config={config} onSaved={onSaved} />
      </ToastProvider>
    </MemoryRouter>,
  )
  return onSaved
}

afterEach(() => vi.unstubAllGlobals())

describe('tarjeta de configuración de Microsoft', () => {
  it('valida el ID de cliente antes de enviar', async () => {
    const f = mockFetch({})
    const u = userEvent.setup()
    renderCard()
    await u.type(screen.getByLabelText('ID de cliente'), 'hola')
    await u.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/ID de cliente/)
    expect(callsOf(f)).toHaveLength(0)
  })

  it('guarda ID, inquilino y secreto', async () => {
    const f = mockFetch({ 'PUT /api/settings/microsoft': { body: { ...base, configurado: true, clientId: GUID, tieneSecreto: true } } })
    const u = userEvent.setup()
    const onSaved = renderCard()
    await u.type(screen.getByLabelText('ID de cliente'), GUID)
    await u.type(screen.getByLabelText('Secreto de cliente'), 'mi-secreto')
    await u.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const put = f.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
    expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({ clientId: GUID, tenantId: 'common', clientSecret: 'mi-secreto' })
  })

  it('con secreto guardado lo enmascara y permite quitarlo', async () => {
    const f = mockFetch({ 'PUT /api/settings/microsoft': { body: base } })
    const u = userEvent.setup()
    renderCard({ ...base, configurado: true, clientId: GUID, tieneSecreto: true })
    expect(screen.getByText('Secreto guardado')).toBeInTheDocument()
    expect(screen.queryByLabelText('Secreto de cliente')).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Quitar' }))
    await u.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(callsOf(f)).toContain('PUT /api/settings/microsoft'))
    const put = f.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
    expect(JSON.parse((put![1] as RequestInit).body as string).clientSecret).toBeNull()
  })

  it('copia la dirección de redirección sugerida', async () => {
    const copy = vi.spyOn(clipboard, 'copiarTexto').mockResolvedValue(true)
    const u = userEvent.setup()
    renderCard()
    await u.click(screen.getByRole('button', { name: 'Copiar dirección de redirección' }))
    expect(copy).toHaveBeenCalledWith(base.redirectUriSugerida)
  })

  it('enlaza a la guía rápida', () => {
    renderCard()
    expect(screen.getByRole('link', { name: /Ver guía rápida/ })).toHaveAttribute('href', '/ajustes/guia-microsoft')
  })
})
