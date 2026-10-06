import { copiarTexto } from './clipboard'

const setClipboard = (v: unknown) => Object.defineProperty(navigator, 'clipboard', { value: v, configurable: true })

afterEach(() => {
  vi.restoreAllMocks()
  setClipboard(undefined)
})

describe('copiarTexto', () => {
  it('usa navigator.clipboard cuando está disponible', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    expect(await copiarTexto('hola')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hola')
  })

  it('si clipboard falla cae a textarea + execCommand', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denegado')) })
    const exec = vi.fn().mockReturnValue(true)
    document.execCommand = exec
    expect(await copiarTexto('hola')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('sin navigator.clipboard (contexto no seguro) usa execCommand', async () => {
    setClipboard(undefined)
    document.execCommand = vi.fn().mockReturnValue(true)
    expect(await copiarTexto('x')).toBe(true)
  })

  it('devuelve false si ningún método funciona', async () => {
    setClipboard(undefined)
    document.execCommand = vi.fn().mockReturnValue(false)
    expect(await copiarTexto('x')).toBe(false)
    document.execCommand = vi.fn(() => {
      throw new Error('no')
    })
    expect(await copiarTexto('x')).toBe(false)
  })
})
