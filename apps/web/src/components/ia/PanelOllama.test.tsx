import { render, screen } from '@testing-library/react'
import { hardwareIa } from '../../test/ajustesIa'
import PanelOllama from './PanelOllama'

describe('PanelOllama', () => {
  it('avisa que hay que actualizar Ollama si es anterior a la versión mínima de Qwen3-VL', () => {
    render(
      <PanelOllama
        hardware={hardwareIa({ ollama: { alcanzable: true, version: '0.11.4', modelos: ['qwen3-vl:4b-instruct'], versionMinima: '0.12.7', requiereActualizar: true } })}
        onRecheck={() => {}}
        modelos={['qwen3-vl:4b-instruct']}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/anterior a la versión 0\.12\.7/)
  })

  it('sin aviso cuando la versión es suficiente', () => {
    render(<PanelOllama hardware={hardwareIa()} onRecheck={() => {}} modelos={['qwen3-vl:4b-instruct']} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Ollama está listo/)
  })
})
