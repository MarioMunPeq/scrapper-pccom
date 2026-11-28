import { Star } from 'lucide-react'
import ProductCard from '../components/ProductCard'
import type { Product } from '../lib/data'
import { formatNumber } from '../lib/format'
import { HREFS } from '../lib/router'

interface FavoritesProps {
  products: Product[]
  favorites: Set<string>
  onToggleFavorite: (sku: string) => void
  onOpenProduct: (sku: string) => void
}

export default function Favorites({
  products,
  favorites,
  onToggleFavorite,
  onOpenProduct,
}: FavoritesProps) {
  const saved = products
    .filter((product) => favorites.has(product.sku))
    .sort((a, b) => {
      if (a.isDiscontinued !== b.isDiscontinued) return a.isDiscontinued ? 1 : -1
      return a.shortName.localeCompare(b.shortName, 'es')
    })

  return (
    <div className="page favorites">
      <div className="container">
        <header className="favorites-head">
          <div>
            <p className="eyebrow">
              <span className="eyebrow__dot" aria-hidden="true" />
              Favoritos · {formatNumber(saved.length)}{' '}
              {saved.length === 1 ? 'guardado' : 'guardados'}
            </p>
            <h1>Tus favoritos.</h1>
          </div>
          <p className="favorites-head__note">
            Se guardan solo en este navegador. Sin cuenta, sin servidor y sin compartir tus
            datos con nadie.
          </p>
        </header>

        {saved.length > 0 ? (
          <div className="product-grid">
            {saved.map((product) => (
              <ProductCard
                key={product.sku}
                product={product}
                isFavorite={favorites.has(product.sku)}
                onToggleFavorite={onToggleFavorite}
                onOpen={() => onOpenProduct(product.sku)}
              />
            ))}
          </div>
        ) : (
          <div className="empty">
            <p className="eyebrow">
              <Star size={13} strokeWidth={1.7} aria-hidden="true" /> Lista vacía
            </p>
            <h1>Aún no has guardado ninguno.</h1>
            <p>
              Pulsa la estrella de cualquier tarjeta para seguir su precio. Lo encontrarás aquí
              la próxima vez que vuelvas, aunque cierres el navegador.
            </p>
            <div className="empty__actions">
              <a className="btn btn--primary" href={HREFS.catalog}>
                Explorar el catálogo
              </a>
              <a className="btn btn--ghost" href={HREFS.home}>
                Volver al resumen
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
