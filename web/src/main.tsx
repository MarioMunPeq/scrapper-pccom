import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

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
        <div
          role="alert"
          style={{
            margin: '2rem auto',
            maxWidth: '640px',
            padding: '1.5rem',
            fontFamily: 'system-ui, sans-serif',
            color: '#f8fafc',
            background: '#1e293b',
            border: '1px solid #ef4444',
            borderRadius: '8px',
          }}
        >
          <h1 style={{ marginTop: 0, fontSize: '1.25rem' }}>
            Se ha producido un error
          </h1>
          <p style={{ marginBottom: '1rem' }}>
            La aplicación no ha podido mostrarse correctamente.
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: '0.8rem',
              background: '#0f172a',
              padding: '0.75rem',
              borderRadius: '6px',
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              cursor: 'pointer',
              borderRadius: '6px',
              border: 'none',
              background: '#22c55e',
              color: '#0f172a',
              fontWeight: 600,
            }}
          >
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

// Manejo de routing hash simple para páginas de detalle
// #/product?sku=XXXXX  o  #/product/SKU

const url = window.location.hash
const detailSku = url ? url.replace('#/product/', '') : ''

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

// Si hay un SKU en el hash, actualizar la UI para mostrar el detalle
if (detailSku) {
  const event = new Event('hashchange')
  window.dispatchEvent(event)
}

// Escuchar cambios de hash para navegación SPA
window.addEventListener('hashchange', () => {
  const newUrl = window.location.hash
  const newSku = newUrl ? newUrl.replace('#/product/', '') : ''
  document.dispatchEvent(new CustomEvent('product:sku:change', {
    detail: { sku: newSku }
  }))
})
