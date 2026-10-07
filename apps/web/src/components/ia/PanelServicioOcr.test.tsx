import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ajustesOcr } from '../../test/ajustesOcr'
import PanelServicioOcr from './PanelServicioOcr'

const servidor = { escritorio: false, servidor: true, so: 'linux' as const }

describe('PanelServicioOcr', () => {
  it('listo: aviso verde sin respaldo', () => {
    render(<PanelServicioOcr ajustes={ajustesOcr({ entorno: servidor, servicioLocal: { estado: 'listo' } })} onRecheck={() => {}} />)
    expect(screen.getByText(/El servicio de OCR está funcionando/)).toBeInTheDocument()
    expect(screen.queryByText(/Tesseract/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Probar el OCR/ })).toBeInTheDocument()
  })

  it('listo con respaldo: avisa de Tesseract', () => {
    render(<PanelServicioOcr ajustes={ajustesOcr({ entorno: servidor, servicioLocal: { estado: 'listo', fallbackReason: 'paddle no cargó' } })} onRecheck={() => {}} />)
    expect(screen.getByText(/Tesseract como respaldo, menos preciso con manuscrito/)).toBeInTheDocument()
  })

  it('detenido: muestra mensaje, pasos y Probar de nuevo', async () => {
    let fin: () => void = () => {}
    const onRecheck = vi.fn(() => new Promise<void>((r) => { fin = r }))
    render(<PanelServicioOcr ajustes={ajustesOcr({ entorno: servidor, servicioLocal: { estado: 'detenido', mensaje: 'No responde ocr-local.' } })} onRecheck={onRecheck} />)
    expect(screen.getByText(/No responde ocr-local/)).toBeInTheDocument()
    expect(screen.getByText('docker compose up -d ocr-local')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Probar de nuevo' }))
    expect(onRecheck).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: /Buscando/ })).toBeDisabled()
    fin()
    expect(await screen.findByRole('button', { name: 'Probar de nuevo' })).toBeEnabled()
  })
})
