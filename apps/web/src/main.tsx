import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { SessionProvider } from './context/session'
import { ToastProvider } from './context/toasts'
import { BASE_PATH } from './lib/base'
import { captureKeyFromHash, usaE2e } from './lib/e2e'
import './index.css'

// La clave de cifrado llega en el # del QR (nunca al servidor): se guarda y se quita de la barra.
captureKeyFromHash()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={BASE_PATH || undefined}>
        <ToastProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)

// Por el relay (/d/<id>) el service worker es el del arranque verificado (apps/relay/bootstrap/sw.js): no se registra otro.
if ('serviceWorker' in navigator && import.meta.env.PROD && !usaE2e()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${BASE_PATH}/sw.js`).catch(() => {})
  })
}
