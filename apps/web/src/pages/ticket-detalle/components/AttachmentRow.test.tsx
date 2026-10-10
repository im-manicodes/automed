import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { mockFetch } from '../../../test/mockFetch'
import type { AttachmentInfo } from '../../../lib/api'
import AttachmentRow from './AttachmentRow'

afterEach(() => vi.unstubAllGlobals())

const att = (status: AttachmentInfo['status']): AttachmentInfo => ({ id: 'a1', filename: 'nota.pdf', size: 1000, status }) as AttachmentInfo

describe('AttachmentRow', () => {
  it('muestra la confianza de la lectura y el botón de dudas cuando necesita revisión', async () => {
    mockFetch({
      'GET /api/attachments/a1/pages': {
        body: {
          attachmentId: 'a1',
          filename: 'nota.pdf',
          status: 'necesita_revision',
          confianza: 0.62,
          nivel: 'baja',
          pages: [{ pageNumber: 1, confianza: 0.62, nivel: 'baja', motor: 'azure', regions: [{ id: 'r1', status: 'dudoso' }] }],
        },
      },
    })
    render(<MemoryRouter><AttachmentRow threadId="t1" att={att('necesita_revision')} /></MemoryRouter>)
    expect(await screen.findByText('Lectura dudosa (62 %)')).toBeInTheDocument()
    expect(await screen.findByText('1 duda por revisar')).toBeInTheDocument()
  })

  it('en un PDF listo también muestra la confianza', async () => {
    mockFetch({
      'GET /api/attachments/a1/pages': {
        body: { attachmentId: 'a1', filename: 'nota.pdf', status: 'listo', confianza: null, nivel: 'digital', pages: [{ pageNumber: 1, confianza: null, nivel: 'digital', motor: 'pdf-text', regions: [] }] },
      },
    })
    render(<MemoryRouter><AttachmentRow threadId="t1" att={att('listo')} /></MemoryRouter>)
    expect(await screen.findByText('Texto digital')).toBeInTheDocument()
  })
})
