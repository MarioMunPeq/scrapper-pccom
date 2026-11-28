import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react'
import ProductCard from '../components/ProductCard'
import SkeletonCard from '../components/SkeletonCard'
import FilterPanel from '../components/FilterPanel'
import FilterSheet from '../components/FilterSheet'
import SortMenu from '../components/SortMenu'
import {
  countActiveFilters,
  filterProducts,
  sortProducts,
  type Filters,
  type Meta,
  type Product,
  type SortKey,
} from '../lib/data'
import {
  formatDayMonth,
  formatNumber,
  formatPrice,
} from '../lib/format'
import { HREFS } from '../lib/router'
import { scrollToTarget } from '../lib/motion'

const PAGE_SIZE = 48

interface CatalogProps {
  products: Product[]
  meta: Meta
  filters: Filters
  sort: SortKey
  favorites: Set<string>
  page: number
  loading?: boolean
  onPageChange: (page: number) => void
  onFiltersChange: (filters: Filters) => void
  onSortChange: (sort: SortKey) => void
  onToggleFavorite: (sku: string) => void
  onOpenProduct: (sku: string) => void
  onClearFilters: () => void
}

function pageItems(current: number, total: number): (number | 'dots')[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const items: (number | 'dots')[] = [1]
  const from = Math.max(2, current - 1)
  const to = Math.min(total - 1, current + 1)
  if (from > 2) items.push('dots')
  for (let page = from; page <= to; page++) items.push(page)
  if (to < total - 1) items.push('dots')
  items.push(total)
  return items
}

function priceOf(value: string): number | null {
  const parsed = Number(value.replace(',', '.'))
  return value.trim() && Number.isFinite(parsed) ? parsed : null
}

export default function Catalog({
  products,
  meta,
  filters,
  sort,
  favorites,
  page,
  loading = false,
  onPageChange,
  onFiltersChange,
  onSortChange,
  onToggleFavorite,
  onOpenProduct,
  onClearFilters,
}: CatalogProps) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const prevSignature = useRef('')

  const activeCount = countActiveFilters(filters)
  const filtered = useMemo(
    () => (loading ? [] : sortProducts(filterProducts(products, filters, favorites), sort)),
    [loading, products, filters, favorites, sort]
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const signature = `${JSON.stringify(filters)}|${sort}`

  useEffect(() => {
    if (prevSignature.current && prevSignature.current !== signature) {
      onPageChange(1)
    }
    prevSignature.current = signature
  }, [signature, onPageChange])

  useEffect(() => {
    if (page > totalPages) onPageChange(totalPages)
  }, [page, totalPages, onPageChange])

  const activeMeta = products.filter((product) => !product.isDiscontinued)
  const withPrice = activeMeta.filter((product) => product.currentPrice !== null).length

  const chips: { key: string; label: string; remove: () => void }[] = []
  if (filters.search.trim()) {
    chips.push({
      key: 'search',
      label: `“${filters.search.trim()}”`,
      remove: () => onFiltersChange({ ...filters, search: '' }),
    })
  }
  const minPrice = priceOf(filters.minPrice)
  const maxPrice = priceOf(filters.maxPrice)
  if (minPrice !== null || maxPrice !== null) {
    chips.push({
      key: 'price',
      label: `${minPrice !== null ? formatPrice(minPrice) : '0 €'} – ${
        maxPrice !== null ? formatPrice(maxPrice) : 'sin máximo'
      }`,
      remove: () => onFiltersChange({ ...filters, minPrice: '', maxPrice: '' }),
    })
  }
  const groupLabels: { group: 'cpuFamilies' | 'rams' | 'ssds' | 'brands'; prefix: string }[] = [
    { group: 'cpuFamilies', prefix: 'CPU' },
    { group: 'rams', prefix: 'RAM' },
    { group: 'ssds', prefix: 'SSD' },
    { group: 'brands', prefix: 'Marca' },
  ]
  for (const { group, prefix } of groupLabels) {
    for (const value of filters[group]) {
      chips.push({
        key: `${group}-${value}`,
        label: `${prefix} · ${value}`,
        remove: () =>
          onFiltersChange({
            ...filters,
            [group]: filters[group].filter((item) => item !== value),
          } as Filters),
      })
    }
  }
  const switches: { key: keyof Filters; label: string }[] = [
    { key: 'onlyDiscount', label: 'Con descuento' },
    { key: 'onlyMin', label: 'Mínimo histórico' },
    { key: 'onlyRecentDrop', label: 'Bajada reciente' },
    { key: 'onlyFavorites', label: 'Solo favoritos' },
    { key: 'showDiscontinued', label: 'Con descatalogados' },
  ]
  for (const item of switches) {
    if (filters[item.key]) {
      chips.push({
        key: item.key,
        label: item.label,
        remove: () => onFiltersChange({ ...filters, [item.key]: false } as Filters),
      })
    }
  }

  const goToPage = (next: number) => {
    if (next < 1 || next > totalPages || next === safePage) return
    onPageChange(next)
    scrollToTarget('.results-bar', -80)
  }

  return (
    <div className="page catalog">
      <div className="container">
        <header className="catalog-head">
          <div>
            <p className="eyebrow">
              <span className="eyebrow__dot" aria-hidden="true" />
              Catálogo · {formatNumber(activeMeta.length)} PCs
            </p>
            <h1>El catálogo completo.</h1>
            <p className="catalog-head__note">
              Precios finales con IVA, ordenados por lo que de verdad ha cambiado. Filtra por
              hardware, precio o descuento.
            </p>
          </div>
          <div className="catalog-head__meta">
            <div>
              <span className="catalog-meta__key">PCs activos</span>
              <span className="catalog-meta__value">{formatNumber(activeMeta.length)}</span>
            </div>
            <div>
              <span className="catalog-meta__key">Con precio</span>
              <span className="catalog-meta__value">{formatNumber(withPrice)}</span>
            </div>
            <div>
              <span className="catalog-meta__key">Última captura</span>
              <span className="catalog-meta__value">
                {meta.lastScrape ? formatDayMonth(meta.lastScrape) : '—'}
              </span>
            </div>
          </div>
        </header>

        <div className="catalog-layout">
          <aside className="filters" aria-label="Filtros del catálogo">
            {loading ? (
              <div className="skeleton" style={{ height: 520 }} aria-hidden="true" />
            ) : (
              <FilterPanel
                products={products}
                filters={filters}
                favorites={favorites}
                onChange={onFiltersChange}
                onClear={onClearFilters}
              />
            )}
          </aside>

          <div className="results">
            <div className="results-bar">
              <p className="results-bar__count">
                <strong>{formatNumber(filtered.length)}</strong>{' '}
                {filtered.length === 1 ? 'PC' : 'PCs'} · página {safePage} de {totalPages}
              </p>
              <div className="results-bar__actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm mobile-filter-btn"
                  onClick={() => setSheetOpen(true)}
                >
                  <SlidersHorizontal size={15} strokeWidth={1.7} aria-hidden="true" />
                  Filtros
                  {activeCount > 0 ? ` · ${activeCount}` : ''}
                </button>
                <SortMenu value={sort} onChange={onSortChange} />
              </div>
            </div>

            {chips.length > 0 && (
              <div className="active-filters" aria-label="Filtros activos">
                {chips.map((chip) => (
                  <span className="active-filter" key={chip.key}>
                    {chip.label}
                    <button
                      type="button"
                      aria-label={`Quitar filtro ${chip.label}`}
                      onClick={chip.remove}
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  </span>
                ))}
                <button type="button" className="active-filter" onClick={onClearFilters}>
                  Limpiar todo
                </button>
              </div>
            )}

            {loading ? (
              <div className="product-grid" aria-hidden="true">
                {Array.from({ length: 9 }, (_, index) => (
                  <SkeletonCard key={index} />
                ))}
              </div>
            ) : visible.length > 0 ? (
              <>
                <div className="product-grid" data-product-grid="true">
                  {visible.map((product) => (
                    <ProductCard
                      key={product.sku}
                      product={product}
                      isFavorite={favorites.has(product.sku)}
                      onToggleFavorite={onToggleFavorite}
                      onOpen={() => onOpenProduct(product.sku)}
                    />
                  ))}
                </div>

                {totalPages > 1 && (
                  <nav className="pagination" aria-label="Paginación del catálogo">
                    <span className="pagination__info">
                      {formatNumber((safePage - 1) * PAGE_SIZE + 1)}–
                      {formatNumber(Math.min(safePage * PAGE_SIZE, filtered.length))} de{' '}
                      {formatNumber(filtered.length)}
                    </span>
                    <div className="pagination__pages">
                      <button
                        type="button"
                        className="page-btn"
                        aria-label="Página anterior"
                        disabled={safePage === 1}
                        onClick={() => goToPage(safePage - 1)}
                      >
                        <ChevronLeft size={16} strokeWidth={1.8} />
                      </button>
                      {pageItems(safePage, totalPages).map((item, index) =>
                        item === 'dots' ? (
                          <span className="page-ellipsis" key={`dots-${index}`}>
                            …
                          </span>
                        ) : (
                          <button
                            key={item}
                            type="button"
                            className={`page-btn${item === safePage ? ' is-active' : ''}`}
                            aria-current={item === safePage ? 'page' : undefined}
                            onClick={() => goToPage(item)}
                          >
                            {item}
                          </button>
                        )
                      )}
                      <button
                        type="button"
                        className="page-btn"
                        aria-label="Página siguiente"
                        disabled={safePage === totalPages}
                        onClick={() => goToPage(safePage + 1)}
                      >
                        <ChevronRight size={16} strokeWidth={1.8} />
                      </button>
                    </div>
                  </nav>
                )}
              </>
            ) : (
              <div className="empty">
                <p className="eyebrow">0 resultados</p>
                <h1>Nada por aquí.</h1>
                <p>
                  No hay PCs que cumplan estos filtros. Prueba a quitar alguno o vuelve al
                  catálogo completo: los precios se actualizan en cada scrape.
                </p>
                <div className="empty__actions">
                  <button type="button" className="btn btn--primary" onClick={onClearFilters}>
                    Quitar todos los filtros
                  </button>
                  <a className="btn btn--ghost" href={HREFS.home}>
                    Volver al resumen
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        products={products}
        filters={filters}
        favorites={favorites}
        onChange={onFiltersChange}
        onClear={onClearFilters}
        resultCount={filtered.length}
      />
    </div>
  )
}
