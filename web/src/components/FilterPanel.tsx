import { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import {
  countActiveFilters,
  filterOptions,
  priceBounds,
  priceHistogram,
  type Filters,
  type FilterGroup,
  type Product,
} from '../lib/data'
import { formatPrice } from '../lib/format'

interface FilterPanelProps {
  products: Product[]
  filters: Filters
  favorites: Set<string>
  onChange: (filters: Filters) => void
  onClear: () => void
  hideHead?: boolean
}

function toggled(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

function numeric(value: string): number | null {
  const parsed = Number(value.replace(',', '.'))
  return value.trim() && Number.isFinite(parsed) ? parsed : null
}

export default function FilterPanel({
  products,
  filters,
  favorites,
  onChange,
  onClear,
  hideHead = false,
}: FilterPanelProps) {
  const [allBrands, setAllBrands] = useState(false)
  const activeCount = countActiveFilters(filters)
  const bounds = useMemo(() => priceBounds(products), [products])
  const selectedMin = numeric(filters.minPrice) ?? bounds.min
  const selectedMax = numeric(filters.maxPrice) ?? bounds.max
  const low = Math.min(selectedMin, selectedMax)
  const high = Math.max(selectedMin, selectedMax)

  const bins = 28
  const histogram = useMemo(
    () => priceHistogram(products, bins, bounds.min, bounds.max),
    [products, bounds.min, bounds.max]
  )
  const histogramMax = Math.max(1, ...histogram)

  const groups: { group: FilterGroup; title: string; label: (value: string) => string }[] = [
    { group: 'cpuFamilies', title: 'Procesador', label: (value) => value },
    { group: 'rams', title: 'Memoria RAM', label: (value) => value },
    { group: 'ssds', title: 'Almacenamiento', label: (value) => value },
    { group: 'brands', title: 'Marca', label: (value) => value },
  ]

  const optionsByGroup = useMemo(() => {
    const map = {} as Record<FilterGroup, ReturnType<typeof filterOptions>>
    for (const { group } of groups) {
      map[group] = filterOptions(products, filters, favorites, group)
    }
    return map
  }, [products, filters, favorites])

  const update = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })

  const setPrice = (min: number, max: number) => {
    const nextMin = Math.min(min, max)
    const nextMax = Math.max(min, max)
    onChange({
      ...filters,
      minPrice: nextMin <= bounds.min ? '' : String(nextMin),
      maxPrice: nextMax >= bounds.max ? '' : String(nextMax),
    })
  }

  const switchRows: { key: keyof Filters; label: string }[] = [
    { key: 'onlyDiscount', label: 'Solo con descuento vs PVPR' },
    { key: 'onlyMin', label: 'En mínimo histórico' },
    { key: 'onlyRecentDrop', label: 'Bajada en el último scrape' },
    { key: 'onlyFavorites', label: 'Solo favoritos' },
    { key: 'showDiscontinued', label: 'Incluir descatalogados' },
  ]

  return (
    <div className="filters__inner">
      {!hideHead && (
        <div className="filters__head">
          <span className="filters__title">Filtros {activeCount > 0 ? `· ${activeCount}` : ''}</span>
          {activeCount > 0 && (
            <button type="button" className="filters__clear" onClick={onClear}>
              Limpiar
            </button>
          )}
        </div>
      )}

      <section className="filter-group" aria-label="Buscar">
        <div className="search-field">
          <Search className="search-field__icon" size={15} strokeWidth={1.7} aria-hidden="true" />
          <input
            type="text"
            value={filters.search}
            placeholder="Buscar nombre, CPU o marca"
            aria-label="Buscar productos"
            onChange={(event) => update({ search: event.target.value })}
          />
          {filters.search && (
            <button
              type="button"
              className="search-field__clear"
              aria-label="Borrar búsqueda"
              onClick={() => update({ search: '' })}
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </section>

      <section className="filter-group" aria-labelledby="filter-price">
        <div className="filter-group__head">
          <p className="filter-group__title" id="filter-price">
            Precio
          </p>
          <span className="filter-group__count">
            {formatPrice(bounds.min)} – {formatPrice(bounds.max)}
          </span>
        </div>
        <div className="price-range">
          <div className="price-range__values">
            <span>{formatPrice(low)}</span>
            <span>{formatPrice(high)}</span>
          </div>
          <div className="histogram" aria-hidden="true">
            {histogram.map((count, index) => {
              const binFrom = bounds.min + (index / bins) * (bounds.max - bounds.min)
              const binTo = bounds.min + ((index + 1) / bins) * (bounds.max - bounds.min)
              const active = binTo >= low && binFrom <= high
              return (
                <span
                  key={index}
                  className={`histogram__bar${active ? ' is-active' : ''}`}
                  style={{ height: `${Math.max(4, (count / histogramMax) * 100)}%` }}
                />
              )
            })}
          </div>
          <div className="range-slider">
            <span className="range-slider__track" aria-hidden="true" />
            <span
              className="range-slider__fill"
              aria-hidden="true"
              style={{
                left: `${((low - bounds.min) / Math.max(1, bounds.max - bounds.min)) * 100}%`,
                right: `${100 - ((high - bounds.min) / Math.max(1, bounds.max - bounds.min)) * 100}%`,
              }}
            />
            <input
              type="range"
              min={bounds.min}
              max={bounds.max}
              step={10}
              value={low}
              aria-label="Precio mínimo"
              onChange={(event) => setPrice(Number(event.target.value), high)}
            />
            <input
              type="range"
              min={bounds.min}
              max={bounds.max}
              step={10}
              value={high}
              aria-label="Precio máximo"
              onChange={(event) => setPrice(low, Number(event.target.value))}
              style={{ zIndex: 2 }}
            />
          </div>
        </div>
      </section>

      {groups.map(({ group, title, label }) => {
        const options = optionsByGroup[group]
        const visible = group === 'brands' && !allBrands ? options.slice(0, 8) : options
        if (!options.length) return null
        return (
          <section className="filter-group" key={group}>
            <div className="filter-group__head">
              <p className="filter-group__title">{title}</p>
              <span className="filter-group__count">
                {filters[group].length > 0 ? `${filters[group].length} sel.` : options.length}
              </span>
            </div>
            <div className={`filter-group__body${group === 'brands' && allBrands ? ' filter-scroll' : ''}`}>
              {visible.map((option) => {
                const checked = filters[group].includes(option.value)
                const disabled = option.count === 0 && !checked
                return (
                  <label
                    key={option.value}
                    className={`check-row${disabled ? ' is-disabled' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() =>
                        update({ [group]: toggled(filters[group], option.value) } as Partial<Filters>)
                      }
                    />
                    <span className="check-row__box">
                      <Check size={12} strokeWidth={3} aria-hidden="true" />
                    </span>
                    <span className="check-row__text">{label(option.value)}</span>
                    <span className="check-row__count">{option.count}</span>
                  </label>
                )
              })}
            </div>
            {group === 'brands' && options.length > 8 && (
              <button
                type="button"
                className="filter-more"
                onClick={() => setAllBrands((current) => !current)}
              >
                {allBrands ? 'Ver menos' : `Ver las ${options.length} marcas`}
              </button>
            )}
          </section>
        )
      })}

      <section className="filter-group" aria-label="Filtros rápidos">
        <div className="filter-group__head">
          <p className="filter-group__title">Atajos</p>
        </div>
        <div className="filter-group__body">
          {switchRows.map((row) => {
            const checked = Boolean(filters[row.key])
            return (
              <button
                key={row.key}
                type="button"
                className="switch-row"
                role="switch"
                aria-checked={checked}
                onClick={() => update({ [row.key]: !checked } as Partial<Filters>)}
              >
                <span>{row.label}</span>
                <span className="switch" aria-hidden="true">
                  <span className="switch__thumb" />
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
