import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource-variable/geist/wght.css'
import '@fontsource-variable/geist-mono/wght.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'

// ============================================================
// Error boundary: evita la "pantalla en gris" si el render falla
// ============================================================

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Error de render:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="container">
          <div role="alert" className="fatal">
            <p className="eyebrow">Error de render</p>
            <h1>La aplicación no ha podido mostrarse.</h1>
            <p>{this.state.error.message}</p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => window.location.reload()}
            >
              Recargar
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ============================================================
// Favicon respetando la base configurada por Vite
// ============================================================

const faviconHref = import.meta.env.BASE_URL + 'favicon.svg'
let faviconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
if (!faviconLink) {
  faviconLink = document.createElement('link')
  faviconLink.rel = 'icon'
  document.head.appendChild(faviconLink)
}
faviconLink.type = 'image/svg+xml'
faviconLink.href = faviconHref

// El enrutado por hash (#/, #/catalogo, #/product/SKU) vive en App.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
