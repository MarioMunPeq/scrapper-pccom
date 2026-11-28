import { ArrowUpRight, Star } from 'lucide-react'
import Sparkline from './Sparkline'
import ChipDelta from './ChipDelta'
import { formatDayMonth, formatPctAbs, formatPrice, formatPrice2, plural } from '../lib/format'
import { isAtHistoricalMin, type Product } from '../lib/data'
import { productHref } from '../lib/router'

interface ProductCardProps {
  product: Product
  isFavorite: boolean
  onToggleFavorite: (sku: string) => void
  onOpen?: () => void
}

export default function ProductCard({
  product,
  isFavorite,
  onToggleFavorite,
  onOpen,
}: ProductCardProps) {
  const atMin = isAtHistoricalMin(product)
  const specs = [
    product.attributes.cpu.replace(/^(AMD|Intel)\s+/i, ''),
    product.attributes.ram,
    product.attributes.ssd,
  ].filter(Boolean)
  const brand = product.attributes.marca || 'Sobremesa'
  const sparkValues =
    product.sparkline.length > 0
      ? product.sparkline
      : product.currentPrice !== null
        ? [product.currentPrice]
        : []
  const recentPct = product.deltaPct
  const showDiscount = (recentPct === null || recentPct === 0) && (product.discountPvpr ?? 0) > 0

  return (
    <article className="card" data-card="true" data-sku={product.sku}>
      <div className="card__top">
        <span className="card__brand">{brand}</span>
        <button
          type="button"
          className={`card__fav${isFavorite ? ' is-on' : ''}`}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onToggleFavorite(product.sku)
          }}
        >
          <Star size={16} strokeWidth={1.6} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      {(product.isNew || atMin || product.isDiscontinued) && (
        <div className="card__badges">
          {product.isNew && <span className="badge badge--new" data-micro="true">Nuevo</span>}
          {atMin && <span className="badge badge--min" data-micro="true">Mín. histórico</span>}
          {product.isDiscontinued && <span className="badge badge--gone" data-micro="true">Descatalogado</span>}
        </div>
      )}

      <h3 className="card__title">
        <a href={productHref(product.sku)} onClick={onOpen}>
          {product.shortName}
        </a>
      </h3>

      {specs.length > 0 && (
        <div className="card__specs">
          {specs.map((spec) => (
            <span key={spec} className="chip-spec">
              {spec}
            </span>
          ))}
        </div>
      )}

      <div className="card__spark" aria-hidden="true">
        <Sparkline
          values={sparkValues}
          className={
            sparkValues.length > 1 && sparkValues[sparkValues.length - 1] < sparkValues[0]
              ? 'is-down'
              : sparkValues.length > 1 && sparkValues[sparkValues.length - 1] > sparkValues[0]
                ? 'is-up'
                : 'is-flat'
          }
        />
        <span className="card__spark-note">
          {product.numDiasHistorial} {plural(product.numDiasHistorial, 'día', 'días')}
        </span>
      </div>

      <div className="card__price-row">
        <div className="card__price-block">
          <span className="card__price">{formatPrice2(product.currentPrice)}</span>
          <span className="card__price-note">
            {product.pvpr !== null ? (
              <>
                <span className="card__pvpr">PVPR {formatPrice(product.pvpr)}</span>
                {product.discountPvpr !== null && product.discountPvpr > 0 && (
                  <span>−{formatPctAbs(product.discountPvpr)}</span>
                )}
              </>
            ) : (
              <span>Sin PVPR publicado</span>
            )}
          </span>
        </div>
        {showDiscount ? (
          <ChipDelta pct={-(product.discountPvpr ?? 0)} title="Descuento frente al PVPR" />
        ) : recentPct !== null && recentPct !== 0 ? (
          <ChipDelta pct={recentPct} abs={product.deltaAbs} title="Variación en el último scrape" />
        ) : null}
      </div>

      <div className="card__foot">
        <span className="card__availability">
          {product.isDiscontinued
            ? product.lastSeen
              ? `Visto por última vez el ${formatDayMonth(product.lastSeen)}`
              : 'Descatalogado'
            : product.availabilityShort || 'Disponibilidad sin dato'}
        </span>
        <ArrowUpRight className="card__arrow" size={16} strokeWidth={1.5} aria-hidden="true" />
      </div>
    </article>
  )
}
