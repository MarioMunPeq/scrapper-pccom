import { ArrowLeft, ArrowUpRight, Info, Star } from 'lucide-react'
import PriceChart from '../components/PriceChart'
import ChipDelta from '../components/ChipDelta'
import type { Product as ProductModel } from '../lib/data'
import { isAtHistoricalMin } from '../lib/data'
import {
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatPct,
  formatPctAbs,
  formatPrice,
  formatPrice2,
  plural,
} from '../lib/format'
import { HREFS } from '../lib/router'
import { MILESTONES } from '../lib/milestones'

interface ProductProps {
  product: ProductModel | null
  series: [string, number][]
  isFavorite: boolean
  backLabel: string
  onToggleFavorite: () => void
  onBack: () => void
}

export default function Product({
  product,
  series,
  isFavorite,
  backLabel,
  onToggleFavorite,
  onBack,
}: ProductProps) {
  if (!product) {
    return (
      <div className="page">
        <div className="container">
          <button type="button" className="back-link" onClick={onBack}>
            <ArrowLeft size={14} strokeWidth={1.7} aria-hidden="true" /> {backLabel}
          </button>
          <div className="empty">
            <p className="eyebrow">404 · SKU no encontrado</p>
            <h1>Ese PC no está en el histórico.</h1>
            <p>
              Puede que el enlace esté mal escrito o que el producto nunca se haya capturado.
              Vuelve al catálogo para ver los equipos disponibles.
            </p>
            <div className="empty__actions">
              <a className="btn btn--primary" href={HREFS.catalog}>
                Ir al catálogo
                <ArrowUpRight size={16} strokeWidth={1.7} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const points: [string, number][] =
    series.length > 0
      ? series
      : product.currentPrice !== null && product.lastSeen
        ? [[product.lastSeen, product.currentPrice]]
        : []
  const atMin = isAtHistoricalMin(product)
  const specs = [
    product.attributes.cpu,
    product.attributes.ram,
    product.attributes.ssd,
  ].filter(Boolean)

  return (
    <div className="page product">
      <div className="container">
        <button type="button" className="back-link" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.7} aria-hidden="true" /> {backLabel}
        </button>

        <header className="product-head">
          <div>
            <div className="product-head__eyebrow">
              <span className="eyebrow">
                {product.attributes.marca || 'Sobremesa'} · {product.cpuFamily} · SKU{' '}
                {product.sku}
              </span>
              {product.isNew && <span className="badge badge--new" data-micro="true">Nuevo</span>}
              {atMin && <span className="badge badge--min" data-micro="true">Mín. histórico</span>}
              {product.isDiscontinued && <span className="badge badge--gone" data-micro="true">Descatalogado</span>}
            </div>
            <h1>{product.name}</h1>
            {specs.length > 0 && (
              <div className="product-head__specs">
                {specs.map((spec) => (
                  <span className="chip-spec" key={spec}>
                    {spec}
                  </span>
                ))}
              </div>
            )}
            <p className="product-head__availability">
              <Info size={14} strokeWidth={1.7} aria-hidden="true" />
              {product.isDiscontinued
                ? product.lastSeen
                  ? `Dejó de aparecer en el catálogo. Última observación: ${formatDate(
                      product.lastSeen
                    )}.`
                  : 'Dejó de aparecer en el catálogo.'
                : product.availabilityShort || 'Disponibilidad sin dato en el último scrape.'}
            </p>
          </div>

          <div className="product-price">
            <span className="product-price__label">
              {product.isDiscontinued ? 'Último precio observado' : 'Precio actual'}
            </span>
            <strong className="product-price__value">{formatPrice2(product.currentPrice)}</strong>
            <div className="product-price__row">
              {product.pvpr !== null && (
                <span className="product-price__pvpr">PVPR {formatPrice(product.pvpr)}</span>
              )}
              {product.discountPvpr !== null && product.discountPvpr > 0 && (
                <ChipDelta
                  pct={-product.discountPvpr}
                  title={`${formatPctAbs(product.discountPvpr)} frente al PVPR`}
                />
              )}
              {product.deltaPct !== null && product.deltaPct !== 0 && (
                <ChipDelta pct={product.deltaPct} abs={product.deltaAbs} />
              )}
            </div>
            <div className="product-price__actions">
              <button
                type="button"
                className={`btn btn--secondary btn--md${isFavorite ? ' is-on' : ''}`}
                aria-pressed={isFavorite}
                onClick={onToggleFavorite}
              >
                <Star
                  size={16}
                  strokeWidth={1.6}
                  fill={isFavorite ? 'currentColor' : 'none'}
                  aria-hidden="true"
                />
                {isFavorite ? 'En favoritos' : 'Guardar'}
              </button>
              {product.url && (
                <a
                  className="btn btn--primary btn--md"
                  href={product.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Ver en PcComponentes
                  <ArrowUpRight size={16} strokeWidth={1.7} aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        </header>

        <div className="product-layout">
          <div>
            <div className="chart-panel">
              <div className="chart-panel__head">
                <div>
                  <p className="chart-panel__title">Evolución del precio</p>
                  <p className="chart-panel__meta">
                    {product.numDiasHistorial}{' '}
                    {plural(product.numDiasHistorial, 'observación', 'observaciones')}
                    {product.firstSeen
                      ? ` · desde ${formatDayMonth(product.firstSeen)}`
                      : ''}
                  </p>
                </div>
                <div className="legend" aria-hidden="true">
                  <span className="legend__key">
                    <span className="legend__swatch legend__swatch--line" /> Precio
                  </span>
                  {product.pvpr !== null && (
                    <span className="legend__key">
                      <span className="legend__swatch legend__swatch--pvpr" /> PVPR
                    </span>
                  )}
                </div>
              </div>
              <PriceChart
                points={points}
                pvpr={product.pvpr}
                milestones={MILESTONES}
                height={380}
                chartLabel={`Evolución del precio de ${product.shortName}`}
                emptyLabel="Sin observaciones de precio"
              />
            </div>

            <div className="stats-strip">
              <div className="stat">
                <span className="stat__key">Mínimo histórico</span>
                <span className="stat__value">{formatPrice(product.minPriceHistorico)}</span>
                <span className="stat__note">
                  {atMin ? 'Precio actual en mínimo' : 'Mejor precio registrado'}
                </span>
              </div>
              <div className="stat">
                <span className="stat__key">Máximo histórico</span>
                <span className="stat__value">{formatPrice(product.maxPriceHistorico)}</span>
                <span className="stat__note">Precio más alto observado</span>
              </div>
              <div className="stat">
                <span className="stat__key">Primera observación</span>
                <span className="stat__value">
                  {product.firstSeen ? formatDayMonth(product.firstSeen) : '—'}
                </span>
                <span className="stat__note">
                  {product.firstPrice !== null ? formatPrice2(product.firstPrice) : 'Sin precio'}
                </span>
              </div>
              <div className="stat">
                <span className="stat__key">Última observación</span>
                <span className="stat__value">
                  {product.lastSeen ? formatDayMonth(product.lastSeen) : '—'}
                </span>
                <span className="stat__note">
                  {product.lastUpdated ? formatDateTime(product.lastUpdated) : 'Sin fecha'}
                </span>
              </div>
            </div>
          </div>

          <aside>
            <div className="facts">
              <div className="facts__head">
                <h3>Ficha técnica</h3>
                <span className="mono-label">SKU {product.sku}</span>
              </div>
              {[
                ['Procesador', product.attributes.cpu || 'Sin dato'],
                ['Memoria RAM', product.attributes.ram || 'Sin dato'],
                ['Almacenamiento', product.attributes.ssd || 'Sin dato'],
                ['Marca', product.attributes.marca || 'Sin dato'],
                ['Familia CPU', product.cpuFamily],
                [
                  'Disponibilidad',
                  product.isDiscontinued
                    ? 'Descatalogado'
                    : product.availabilityShort || 'Sin dato',
                ],
                [
                  'Histórico',
                  `${product.numDiasHistorial} ${
                    product.numDiasHistorial === 1 ? 'día' : 'días'
                  } · ${product.totalRegistros} ${
                    product.totalRegistros === 1 ? 'registro' : 'registros'
                  }`,
                ],
                ['Primera vez', product.firstSeen ? formatDate(product.firstSeen) : '—'],
                ['Última vez', product.lastSeen ? formatDate(product.lastSeen) : '—'],
                [
                  'Variación total',
                  product.firstPrice !== null &&
                  product.currentPrice !== null &&
                  product.firstPrice > 0
                    ? formatPct(
                        ((product.currentPrice - product.firstPrice) / product.firstPrice) * 100
                      )
                    : '—',
                ],
              ].map(([key, value]) => (
                <div className="facts__row" key={key}>
                  <span className="facts__key">{key}</span>
                  <span className="facts__value">{value}</span>
                </div>
              ))}
            </div>

            <div className="product-note">
              <Info size={16} strokeWidth={1.7} aria-hidden="true" />
              <p>
                El precio mostrado es el último observado en PcComponentes, con IVA incluido.
                {product.isDiscontinued
                  ? ' El producto ya no aparece en el catálogo: su histórico se conserva para no falsear comparativas.'
                  : ' Si el producto lleva días sin cambiar, el histórico lo refleja tal cual: no se inventan variaciones.'}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
