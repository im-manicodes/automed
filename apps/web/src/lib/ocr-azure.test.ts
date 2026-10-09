import { ajustesOcr } from '../test/ajustesOcr'
import { cambiosAzure, faltaParaOcr } from './ocr'

const ia = { claves: { openai: false, anthropic: false, foundry: false, aws: false } }

describe('Azure en la lectura de PDFs', () => {
  it('pide dirección y clave antes de poder usarlo', () => {
    const a = ajustesOcr()
    expect(faltaParaOcr('azure', a, ia, {})).toMatch(/dirección/)
    expect(faltaParaOcr('azure', a, ia, {}, { endpoint: 'https://x.azure.com' })).toMatch(/clave/)
    expect(faltaParaOcr('azure', a, ia, {}, { endpoint: 'https://x.azure.com', clave: 'k' })).toBeNull()
  })

  it('con lo guardado en el servidor no falta nada, salvo que se quite la clave', () => {
    const a = ajustesOcr({ azureEndpoint: 'https://x.azure.com', claveAzure: true })
    expect(faltaParaOcr('azure', a, ia, {})).toBeNull()
    expect(faltaParaOcr('azure', a, ia, {}, { clave: null })).toMatch(/clave/)
  })

  it('solo envía lo que cambió', () => {
    const a = ajustesOcr({ azureEndpoint: 'https://x.azure.com', claveAzure: true })
    expect(cambiosAzure({}, a)).toBeNull()
    expect(cambiosAzure({ endpoint: 'https://x.azure.com' }, a)).toBeNull()
    expect(cambiosAzure({ endpoint: 'https://y.azure.com', clave: ' k ' }, a)).toEqual({ azureEndpoint: 'https://y.azure.com', claveAzure: 'k' })
    expect(cambiosAzure({ clave: null }, a)).toEqual({ claveAzure: null })
  })
})
