import { useEffect, useMemo, useState } from 'react'
import Sparkline from '../components/Sparkline'
import {
  formatPct,
  formatPrice0,
  initialFilters,
  intFmt,
  isAtHistoricalMin,
  shortName,
  uniqueSorted,
  type Filters,
  type Product,
  type SortKey,
} from '../lib'

interface ListingProps {
  products: Product[]
  totalProducts: number
  filters: Filters
  onFiltersChange: (filters: Filters) => void
  favorites: Set<string>
  onToggleFavorite: (sku: string) => void
  onOpenDetail: () => void
}

const PAGE_SIZE = 48

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'discount', label: 'Mayor descuento vs PVPR' },
  { value: 'recent-drop', label: 'Mayor bajada reciente' },
  { value: 'price-asc', label: 'Precio: menor a mayor' },
  { value: 'price-desc', label: 'Precio: mayor a menor' },
  { value: 'name', label: 'Nombre A–Z' },
]

export default function Listing({
  products,
  totalProducts,
  filters,
  onFiltersChange,
  favorites,
  onToggleFavorite,
  onOpenDetail,
}: ListingProps) {
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const options = useMemo(
    () => ({
      cpu: uniqueSorted(products.map((product) => product.attributes.cpu)),
      ram: uniqueSorted(products.map((product) => product.attributes.ram)),
      ssd: uniqueSorted(products.map((product) => product.attributes.ssd)),
      marca: uniqueSorted(products.map((product) => product.attributes.marca)),
    }),
    [products]
  )

  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [filters, products])

  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    onFiltersChange({ ...filters, [key]: value })
  }

  const activeFilters = useMemo(() => {
    let count = 0
    if (filters.search.trim()) count += 1
    if (filters.minPrice.trim()) count += 1
    if (filters.maxPrice.trim()) count += 1
    if (filters.cpu) count += 1
    if (filters.ram) count += 1
    if (filters.ssd) count += 1
    if (filters.marca) count += 1
    if (filters.onlyDiscount) count += 1
    if (filters.onlyMin) count += 1
    if (filters.onlyFavorites) count += 1
    return count
  }, [filters])

  const shown = products.slice(0, visible)
  const hasMore = products.length > visible

  return (
    <div className="page page--listing">
      <header className="list-head">
        <div>
          <p className="eyebrow">
            <span className="dot" aria-hidden="true" />
            Catálogo completo
          </p>
          <h1>Ordenadores de sobremesa</h1>
          <p className="list-head__lead">
            Filtra por precio y componentes, compara con el PVPR y abre el histórico de cada
            equipo. Los datos vienen del último scrape diario.
          </p>
        </div>
        <div className="list-head__count">
          <strong>{intFmt.format(products.length)}</strong>
          <span>{products.length === 1 ? 'resultado' : 'resultados'}</span>
          <small>de {intFmt.format(totalProducts)} PCs</small>
        </div>
      </header>

      <div className="listing-layout">
        <aside className={`filters${filtersOpen ? ' is-open' : ''}`} aria-label="Filtros">
          <div className="filters__mobile-head">
            <span>Filtros</span>
            <button
              type="button"
              className="filters__toggle"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              {filtersOpen ? 'Cerrar' : 'Abrir'}
            </button>
          </div>

          <div className="filters__inner">
            <div className="filters__row filters__row--head">
              <h2>Filtros</h2>
              <button
                type="button"
                className="filters__clear"
                onClick={() => onFiltersChange({ ...initialFilters })}
                disabled={activeFilters === 0}
              >
                Borrar filtros
                {activeFilters > 0 && <span className="filters__badge">{activeFilters}</span>}
              </button>
            </div>

            <label className="field field--search">
              <span>Buscar</span>
              <input
                type="search"
                value={filters.search}
                placeholder="Modelo, CPU, marca…"
                onChange={(event) => update('search', event.target.value)}
              />
            </label>

            <fieldset className="field field--price">
              <legend>Rango de precio (€)</legend>
              <div className="price-inputs">
                <label>
                  <span className="sr-only">Precio mínimo</span>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    inputMode="numeric"
                    placeholder="Mín."
                    value={filters.minPrice}
                    onChange={(event) => update('minPrice', event.target.value)}
                  />
                </label>
                <span className="price-inputs__dash" aria-hidden="true">
                  —
                </span>
                <label>
                  <span className="sr-only">Precio máximo</span>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    inputMode="numeric"
                    placeholder="Máx."
                    value={filters.maxPrice}
                    onChange={(event) => update('maxPrice', event.target.value)}
                  />
                </label>
              </div>
            </fieldset>

            <label className="field">
              <span>Procesador</span>
              <select value={filters.cpu} onChange={(event) => update('cpu', event.target.value)}>
                <option value="">Todos</option>
                {options.cpu.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Memoria RAM</span>
              <select value={filters.ram} onChange={(event) => update('ram', event.target.value)}>
                <option value="">Todas</option>
                {options.ram.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Almacenamiento SSD</span>
              <select value={filters.ssd} onChange={(event) => update('ssd', event.target.value)}>
                <option value="">Todos</option>
                {options.ssd.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Marca</span>
              <select
                value={filters.marca}
                onChange={(event) => update('marca', event.target.value)}
              >
                <option value="">Todas</option>
                {options.marca.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <div className="filters__checks">
              <label className="check">
                <input
                  type="checkbox"
                  checked={filters.onlyDiscount}
                  onChange={(event) => update('onlyDiscount', event.target.checked)}
                />
                <span>Solo con descuento</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={filters.onlyMin}
                  onChange={(event) => update('onlyMin', event.target.checked)}
                />
                <span>Solo en mínimo histórico</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={filters.onlyFavorites}
                  onChange={(event) => update('onlyFavorites', event.target.checked)}
                />
                <span>Solo favoritos</span>
              </label>
            </div>

            <label className="field">
              <span>Ordenar por</span>
              <select
                value={filters.sort}
                onChange={(event) => update('sort', event.target.value as SortKey)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </aside>

        <div className="results">
          <div className="results__bar">
            <p className="results__count">
              <strong>{intFmt.format(products.length)}</strong>{' '}
              {products.length === 1 ? 'resultado' : 'resultados'}
            </p>
            <label className="results__sort">
              <span>Orden</span>
              <select
                value={filters.sort}
                onChange={(event) => update('sort', event.target.value as SortKey)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {products.length === 0 ? (
            <div className="empty">
              <h2>Ningún PC cumple esos filtros</h2>
              <p>Prueba a ampliar el rango de precio o a quitar alguna restricción.</p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => onFiltersChange({ ...initialFilters })}
              >
                Borrar filtros
              </button>
            </div>
          ) : (
            <>
              <ul className="cards">
                {shown.map((product) => {
                  const atMin = isAtHistoricalMin(product)
                  const hasDiscount =
                    product.discountPvpr !== null && product.discountPvpr > 0
                  const isFavorite = favorites.has(product.sku)
                  return (
                    <li key={product.sku}>
                      <article className="card">
                        <div className="card__top">
                          <span className="card__brand">{product.attributes.marca || 'PC'}</span>
                          <div className="card__badges">
                            {atMin && <span className="badge badge--min">Mín. histórico</span>}
                            {hasDiscount && (
                              <span className="badge badge--discount">
                                −{formatPct(product.discountPvpr)}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            className={`fav${isFavorite ? ' is-on' : ''}`}
                            aria-pressed={isFavorite}
                            aria-label={
                              isFavorite
                                ? `Quitar ${product.name} de favoritos`
                                : `Añadir ${product.name} a favoritos`
                            }
                            onClick={() => onToggleFavorite(product.sku)}
                          >
                            <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
                              <path
                                d="M10 1.8l2.4 5 5.5.8-4 3.9.9 5.5L10 14.4l-4.8 2.6.9-5.5-4-3.9 5.5-.8z"
                                fill={isFavorite ? 'currentColor' : 'none'}
                                stroke="currentColor"
                                strokeWidth="1.4"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </div>

                        <h3 className="card__title">
                          <a href={`#/product/${product.sku}`} onClick={onOpenDetail}>
                            {product.name}
                          </a>
                        </h3>

                        <ul className="card__specs">
                          <li>{product.attributes.cpu || 'CPU n/d'}</li>
                          <li>{product.attributes.ram || 'RAM n/d'}</li>
                          <li>{product.attributes.ssd || 'SSD n/d'}</li>
                        </ul>

                        <div className="card__price-row">
                          <div className="card__price">
                            <strong>{formatPrice0(product.currentPrice)}</strong>
                            {product.pvpr !== null && (
                              <s>{formatPrice0(product.pvpr)}</s>
                            )}
                          </div>
                          <Sparkline values={product.sparkline} className="card__spark" />
                        </div>

                        <div className="card__foot">
                          <span className="card__availability" title={product.availability}>
                            {product.availability || 'Disponibilidad sin datos'}
                          </span>
                          <a
                            className="card__ext"
                            href={product.url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Ver ${shortName(product.name, 30)} en PcComponentes`}
                          >
                            PcComponentes
                            <span aria-hidden="true"> ↗</span>
                          </a>
                        </div>
                      </article>
                    </li>
                  )
                })}
              </ul>

              {hasMore && (
                <div className="load-more">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setVisible((value) => value + PAGE_SIZE)}
                  >
                    Cargar más ({intFmt.format(products.length - visible)} restantes)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
