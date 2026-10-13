import { render, screen } from '@testing-library/react'
import { ajustesOcr } from '../../test/ajustesOcr'
import { mockFetch } from '../../test/mockFetch'
import ConfigOcr from './ConfigOcr'

afterEach(() => vi.unstubAllGlobals())
const props = { awsGuardada: false, claves: {}, onClaves: () => {}, onRecheck: () => {}, onMotor: () => {} }

describe('ConfigOcr', () => {
  it('en servidor con local muestra el panel del servicio', () => {
    mockFetch({})
    render(<ConfigOcr {...props} motor="local" ajustes={ajustesOcr({ entorno: { servidor: true }, servicioLocal: { estado: 'detenido' } })} />)
    expect(screen.getByRole('button', { name: 'Probar de nuevo' })).toBeInTheDocument()
  })

  it('muestra las opciones avanzadas cuando hay un motor y valores', () => {
    mockFetch({})
    const a = ajustesOcr({ motor: 'textract' })
    render(<ConfigOcr {...props} motor="textract" ajustes={a} avanzado={{ visionRetry: a.visionRetry, visionMaxRegions: a.visionMaxRegions, renderDpi: a.renderDpi, textractMode: a.textractMode, visionAmbito: a.visionAmbito }} onAvanzado={() => {}} />)
    expect(screen.getByText('Opciones avanzadas de lectura')).toBeInTheDocument()
    expect(screen.getByLabelText('Modo')).toBeInTheDocument()
  })
  it('con Azure pide dirección y clave y permite probar', () => {
    mockFetch({})
    render(<ConfigOcr {...props} motor="azure" ajustes={ajustesOcr({ motor: 'azure' })} onAzure={() => {}} />)
    expect(screen.getByLabelText('Dirección del recurso de Azure')).toBeInTheDocument()
    expect(screen.getByLabelText('Clave de Azure')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Probar Azure' })).toBeInTheDocument()
  })

  it('con clave de Azure guardada no la muestra', () => {
    mockFetch({})
    render(<ConfigOcr {...props} motor="azure" ajustes={ajustesOcr({ motor: 'azure', azureEndpoint: 'https://x.azure.com', claveAzure: true })} onAzure={() => {}} />)
    expect(screen.getByText('Ya hay una clave guardada')).toBeInTheDocument()
    expect(screen.getByLabelText('Dirección del recurso de Azure')).toHaveValue('https://x.azure.com')
  })
})
