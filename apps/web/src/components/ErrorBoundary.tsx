import { Component, type ErrorInfo, type ReactNode } from 'react'
import { LuTriangleAlert } from 'react-icons/lu'

interface State { failed: boolean }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }
  static getDerivedStateFromError(): State {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Solo el tipo de error y la pila de componentes: nunca contenido de correos.
    console.error('Error de pantalla', error.name, info.componentStack)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="mx-auto max-w-md space-y-4 p-6 text-center">
        <LuTriangleAlert className="mx-auto size-10" aria-hidden />
        <h1 className="text-xl font-bold">Algo salió mal</h1>
        <p className="text-slate-700">No pudimos mostrar esta pantalla. Tus datos están a salvo.</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>Volver a cargar</button>
      </div>
    )
  }
}
