import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'

// Manejo de routing hash simple para páginas de detalle
// #/product?sku=XXXXX  o  #/product/SKU

const url = window.location.hash
const detailSku = url ? url.replace('#/product/', '') : ''

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
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