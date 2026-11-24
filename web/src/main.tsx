import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

import '@fontsource/public-sans/400.css'
import '@fontsource/public-sans/500.css'
import '@fontsource/public-sans/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './style.css'

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
        <div role="alert" className="empty empty--detail" style={{ margin: '3rem auto', maxWidth: 620 }}>
          <h1>Se ha producido un error</h1>
          <p>La aplicación no ha podido mostrarse correctamente.</p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: '0.78rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-dim)',
              background: 'var(--ground-deep)',
              border: '1px solid var(--line)',
              padding: '0.75rem',
              borderRadius: 2,
              margin: 0,
              width: '100%',
            }}
          >
            {this.state.error.message}
          </pre>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Recargar
          </button>
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

// El enrutado por hash (#/, #/listado, #/product/SKU) vive en App.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
