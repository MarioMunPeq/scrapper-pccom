export interface Attributes {
  cpu: string
  ram: string
  ssd: string
  marca: string
}

export interface Product {
  sku: string
  name: string
  url: string
  currentPrice: number | null
  pvpr: number | null
  discountPvpr: number | null
  previousPrice: number | null
  recentChangePct: number | null
  recentDropPct: number | null
  minPriceHistorico: number | null
  maxPriceHistorico: number | null
  firstPrice: number | null
  lastPrice: number | null
  totalRegistros: number
  numDiasHistorial: number
  availability: string
  attributes: Attributes
  hito: string | null
  datosReales: boolean
  showHistoryNote: boolean
  lastUpdated: string | null
  sparkline: number[]
}

export type HistoryMap = Record<string, [string, number][]>

export type SortKey =
  | 'name'
  | 'price-asc'
  | 'price-desc'
  | 'discount'
  | 'recent-drop'

export interface Filters {
  search: string
  minPrice: string
  maxPrice: string
  cpu: string
  ram: string
  ssd: string
  marca: string
  onlyDiscount: boolean
  onlyMin: boolean
  onlyFavorites: boolean
  sort: SortKey
}

export const initialFilters: Filters = {
  search: '',
  minPrice: '',
  maxPrice: '',
  cpu: '',
  ram: '',
  ssd: '',
  marca: '',
  onlyDiscount: false,
  onlyMin: false,
  onlyFavorites: false,
  sort: 'discount',
}

export type View = 'home' | 'list' | 'detail'

export interface Route {
  view: View
  sku: string | null
}

/* ------------------------------------------------------------------ */
/* Números y fechas                                                    */
/* ------------------------------------------------------------------ */

export const eur0 = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

export const eur2 = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const intFmt = new Intl.NumberFormat('es-ES')

export const pctFmt = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return eur2.format(value)
}

export function formatPrice0(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return eur0.format(value)
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${pctFmt.format(value)} %`
}

export function formatSignedPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${pctFmt.format(Math.abs(value))} %`
}

export function formatSignedPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${eur2.format(Math.abs(value))}`
}

/** 'YYYY-MM-DD' -> 'dd/mm/yyyy' */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const parts = iso.slice(0, 10).split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

/** 'YYYY-MM-DD' -> 'dd/mm' */
export function formatDayMonth(iso: string | null | undefined): string {
  if (!iso) return '—'
  const parts = iso.slice(0, 10).split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}`
}

/** 'YYYY-MM-DD HH:MM:SS' -> 'dd/mm/yyyy HH:MM' */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const [date, time] = value.split(' ')
  const clock = time ? time.slice(0, 5) : ''
  return clock ? `${formatDate(date)} ${clock}` : formatDate(date)
}

/** Número de día UTC para escalas de fecha sin saltos de zona horaria. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return NaN
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/* ------------------------------------------------------------------ */
/* Estadística                                                         */
/* ------------------------------------------------------------------ */

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Ticks redondos para un eje Y, incluyendo siempre el máximo. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) {
    const pad = Math.abs(min) > 100 ? Math.abs(min) * 0.1 : 1
    min -= pad
    max += pad
  }
  const span = max - min
  const rawStep = span / Math.max(1, count)
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const normalized = rawStep / magnitude
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) *
    magnitude
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = start; v <= end + step / 2; v += step) {
    ticks.push(Math.round(v * 1000) / 1000)
  }
  return ticks
}

/* ------------------------------------------------------------------ */
/* Favoritos (localStorage con try/catch)                              */
/* ------------------------------------------------------------------ */

const FAVORITES_KEY = 'pccom:favorites'

export function loadFavorites(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

export function saveFavorites(favorites: Set<string>): void {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]))
  } catch {
    /* localStorage puede estar bloqueado; los favoritos siguen en memoria */
  }
}

/* ------------------------------------------------------------------ */
/* Routing hash                                                        */
/* ------------------------------------------------------------------ */

export function parseRoute(hash: string): Route {
  const clean = (hash || '').replace(/^#/, '')
  if (clean.startsWith('/product')) {
    const queryIndex = clean.indexOf('?')
    if (queryIndex >= 0) {
      const params = new URLSearchParams(clean.slice(queryIndex + 1))
      const sku = params.get('sku')
      return { view: 'detail', sku: sku ? decodeURIComponent(sku) : null }
    }
    const match = clean.match(/^\/product\/(.+)$/)
    return { view: 'detail', sku: match ? decodeURIComponent(match[1]) : null }
  }
  if (clean === '/listado' || clean.startsWith('/listado')) {
    return { view: 'list', sku: null }
  }
  return { view: 'home', sku: null }
}

/* ------------------------------------------------------------------ */
/* Serie global: mediana diaria y nº de PCs que bajan                  */
/* ------------------------------------------------------------------ */

export interface GlobalPoint {
  date: string
  median: number | null
  drops: number
  count: number
}

/**
 * A partir de {sku: [[fecha, precio], ...]} (ordenado por fecha) calcula,
 * para cada fecha: la mediana de los precios observados ese día y cuántos
 * SKUs bajaron de precio respecto a su observación anterior.
 */
export function computeGlobalSeries(history: HistoryMap): GlobalPoint[] {
  const pricesByDate = new Map<string, number[]>()
  const dropsByDate = new Map<string, number>()

  for (const sku of Object.keys(history)) {
    const series = history[sku]
    if (!Array.isArray(series)) continue
    let previous: number | null = null
    for (const entry of series) {
      if (!Array.isArray(entry) || entry.length < 2) continue
      const [date, rawPrice] = entry
      const price = Number(rawPrice)
      if (!date || !Number.isFinite(price)) continue

      const bucket = pricesByDate.get(date)
      if (bucket) bucket.push(price)
      else pricesByDate.set(date, [price])

      if (previous !== null && price < previous) {
        dropsByDate.set(date, (dropsByDate.get(date) || 0) + 1)
      }
      previous = price
    }
  }

  return [...pricesByDate.keys()]
    .sort()
    .map((date) => {
      const prices = pricesByDate.get(date) || []
      return {
        date,
        median: median(prices),
        drops: dropsByDate.get(date) || 0,
        count: prices.length,
      }
    })
}

/** Última actualización real del conjunto (fecha + hora del último registro). */
export function latestUpdate(products: Product[]): string | null {
  let latest: string | null = null
  for (const product of products) {
    if (product.lastUpdated && (!latest || product.lastUpdated > latest)) {
      latest = product.lastUpdated
    }
  }
  return latest
}

/** ¿Está en mínimo histórico? Solo tiene sentido con 2+ días de historial. */
export function isAtHistoricalMin(product: Product): boolean {
  if (product.numDiasHistorial < 2) return false
  if (product.currentPrice === null || product.minPriceHistorico === null) return false
  return product.currentPrice <= product.minPriceHistorico + 0.005
}

/* ------------------------------------------------------------------ */
/* Filtros y orden                                                     */
/* ------------------------------------------------------------------ */

function numericBound(value: string): number | null {
  const trimmed = value.trim().replace(',', '.')
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function filterProducts(
  products: Product[],
  filters: Filters,
  favorites: Set<string>
): Product[] {
  const search = filters.search.trim().toLowerCase()
  const minPrice = numericBound(filters.minPrice)
  const maxPrice = numericBound(filters.maxPrice)

  return products.filter((product) => {
    if (search) {
      const haystack = `${product.name} ${product.sku} ${product.attributes.marca}`.toLowerCase()
      if (!haystack.includes(search)) return false
    }
    if (minPrice !== null && (product.currentPrice === null || product.currentPrice < minPrice)) {
      return false
    }
    if (maxPrice !== null && (product.currentPrice === null || product.currentPrice > maxPrice)) {
      return false
    }
    if (filters.cpu && product.attributes.cpu !== filters.cpu) return false
    if (filters.ram && product.attributes.ram !== filters.ram) return false
    if (filters.ssd && product.attributes.ssd !== filters.ssd) return false
    if (filters.marca && product.attributes.marca !== filters.marca) return false
    if (filters.onlyDiscount && !(product.discountPvpr !== null && product.discountPvpr > 0)) {
      return false
    }
    if (filters.onlyMin && !isAtHistoricalMin(product)) return false
    if (filters.onlyFavorites && !favorites.has(product.sku)) return false
    return true
  })
}

export function sortProducts(products: Product[], sort: SortKey): Product[] {
  const sorted = [...products]
  sorted.sort((a, b) => {
    switch (sort) {
      case 'price-asc':
        return (a.currentPrice ?? Infinity) - (b.currentPrice ?? Infinity)
      case 'price-desc':
        return (b.currentPrice ?? -Infinity) - (a.currentPrice ?? -Infinity)
      case 'discount':
        return (b.discountPvpr ?? -1) - (a.discountPvpr ?? -1)
      case 'recent-drop':
        return (b.recentDropPct ?? -1) - (a.recentDropPct ?? -1)
      case 'name':
      default:
        return a.name.localeCompare(b.name, 'es')
    }
  })
  return sorted
}

/** Nombre corto para rankings: corta en la primera CPU o en el primer '/'. */
export function shortName(name: string, max = 52): string {
  const cleaned = name
    .replace(/^Ordenador\s+Sobremesa\s+/i, '')
    .replace(/^PC\s+Sobremesa\s+/i, '')
    .replace(/^PC\s+Gaming\s+/i, '')
    .replace(/^Sobremesa\s+/i, '')
  const cut = cleaned.search(
    /\s+(Intel|AMD|Ryzen|Core|i[3579][-\s]|RTX|GeForce|Windows|W11|WiFi|Wi-Fi|Refrigeración|\d+\s*GB|\d+\s*TB)\b/i
  )
  let short = cut > 0 ? cleaned.slice(0, cut) : cleaned
  short = short.replace(/\s+/g, ' ').trim()
  if (short.length > max) short = `${short.slice(0, max - 1).trimEnd()}…`
  return short || name
}
