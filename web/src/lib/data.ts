import { parseISO } from './format'
import { median } from './scale'
import type { CatalogParams } from './router'

export interface Attributes {
  cpu: string
  ram: string
  ssd: string
  marca: string
}

export interface Product {
  sku: string
  name: string
  shortName: string
  url: string
  currentPrice: number | null
  pvpr: number | null
  discountPvpr: number | null
  prevPrice: number | null
  prevDate: string | null
  deltaAbs: number | null
  deltaPct: number | null
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
  availabilityShort: string
  attributes: Attributes
  cpuFamily: string
  firstSeen: string | null
  lastSeen: string | null
  isNew: boolean
  isDiscontinued: boolean
  lastUpdated: string | null
  sparkline: number[]
}

export type HistoryMap = Record<string, [string, number][]>

export interface Scrape {
  date: string
  time: string
  skus: number
  withPrice: number
  median: number | null
  drops: number
}

export interface Meta {
  generatedAt: string
  lastScrape: string | null
  lastScrapeTime: string
  scrapes: Scrape[]
  totals: {
    entries: number
    active: number
    discontinued: number
    withPrice: number
    withPvpr: number
  }
}

export interface Dataset {
  products: Product[]
  history: HistoryMap
  meta: Meta
}

export type SortKey =
  | 'recent-drop'
  | 'recent-rise'
  | 'price-asc'
  | 'price-desc'
  | 'pvpr-discount'
  | 'near-min'
  | 'name'

export const SORT_LABELS: Record<SortKey, string> = {
  'recent-drop': 'Mayor bajada reciente',
  'recent-rise': 'Mayor subida reciente',
  'price-asc': 'Precio: menor a mayor',
  'price-desc': 'Precio: mayor a menor',
  'pvpr-discount': 'Mayor descuento vs PVPR',
  'near-min': 'Más cerca del mínimo histórico',
  name: 'Nombre A–Z',
}

export const SORT_ORDER: SortKey[] = [
  'recent-drop',
  'recent-rise',
  'price-asc',
  'price-desc',
  'pvpr-discount',
  'near-min',
  'name',
]

export interface Filters {
  search: string
  minPrice: string
  maxPrice: string
  cpuFamilies: string[]
  rams: string[]
  ssds: string[]
  brands: string[]
  onlyDiscount: boolean
  onlyMin: boolean
  onlyRecentDrop: boolean
  onlyFavorites: boolean
  showDiscontinued: boolean
}

export const initialFilters: Filters = {
  search: '',
  minPrice: '',
  maxPrice: '',
  cpuFamilies: [],
  rams: [],
  ssds: [],
  brands: [],
  onlyDiscount: false,
  onlyMin: false,
  onlyRecentDrop: false,
  onlyFavorites: false,
  showDiscontinued: false,
}

export function defaultSort(scrapes: Scrape[]): SortKey {
  return scrapes.length >= 2 ? 'recent-drop' : 'price-asc'
}

const DATA_BASE = import.meta.env.BASE_URL

export async function loadDataset(): Promise<Dataset> {
  const [pricesResponse, historyResponse, metaResponse] = await Promise.all([
    fetch(`${DATA_BASE}data/prices.json`, { cache: 'no-cache' }),
    fetch(`${DATA_BASE}data/history.json`, { cache: 'no-cache' }).catch(() => null),
    fetch(`${DATA_BASE}data/meta.json`, { cache: 'no-cache' }).catch(() => null),
  ])
  if (!pricesResponse.ok) {
    throw new Error(`No se pudo cargar prices.json (HTTP ${pricesResponse.status})`)
  }
  const products = (await pricesResponse.json()) as Product[]
  if (!Array.isArray(products)) throw new Error('prices.json no tiene el formato esperado')

  let history: HistoryMap = {}
  if (historyResponse && historyResponse.ok) {
    try {
      const parsed: unknown = await historyResponse.json()
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        history = parsed as HistoryMap
      }
    } catch {
      history = {}
    }
  }

  let meta: Meta | null = null
  if (metaResponse && metaResponse.ok) {
    try {
      meta = (await metaResponse.json()) as Meta
    } catch {
      meta = null
    }
  }

  if (!meta) {
    const scrapes = deriveScrapes(history)
    const active = products.filter((product) => !product.isDiscontinued)
    const last = scrapes[scrapes.length - 1]
    meta = {
      generatedAt: new Date().toISOString(),
      lastScrape: last ? last.date : null,
      lastScrapeTime: last ? last.time : '',
      scrapes,
      totals: {
        entries: products.length,
        active: active.length,
        discontinued: products.length - active.length,
        withPrice: active.filter((product) => product.currentPrice !== null).length,
        withPvpr: products.filter((product) => product.pvpr !== null).length,
      },
    }
  }

  return { products, history, meta }
}

function deriveScrapes(history: HistoryMap): Scrape[] {
  const byDate = new Map<string, number[]>()
  const drops = new Map<string, number>()
  for (const series of Object.values(history)) {
    if (!Array.isArray(series)) continue
    let previous: number | null = null
    for (const entry of series) {
      const date = String(entry[0]).slice(0, 10)
      const price = Number(entry[1])
      if (!Number.isFinite(price)) continue
      if (!byDate.has(date)) byDate.set(date, [])
      byDate.get(date)!.push(price)
      if (previous !== null && price < previous) drops.set(date, (drops.get(date) || 0) + 1)
      previous = price
    }
  }
  return [...byDate.keys()].sort().map((date) => ({
    date,
    time: '',
    skus: byDate.get(date)!.length,
    withPrice: byDate.get(date)!.length,
    median: median(byDate.get(date)!),
    drops: drops.get(date) || 0,
  }))
}

export function activeProducts(products: Product[]): Product[] {
  return products.filter((product) => !product.isDiscontinued)
}

export function isAtHistoricalMin(product: Product): boolean {
  if (product.numDiasHistorial < 2) return false
  if (product.currentPrice === null || product.minPriceHistorico === null) return false
  if (product.maxPriceHistorico === null) return false
  // Un histórico completamente plano no es un mínimo: hace falta que alguna
  // observación previa haya sido más cara.
  if (product.maxPriceHistorico <= product.minPriceHistorico + 0.005) return false
  return product.currentPrice <= product.minPriceHistorico + 0.005
}

export function specLine(product: Product): string {
  const cpu = product.attributes.cpu.replace(/^(AMD|Intel)\s+/i, '').replace(/\s+/g, ' ').trim()
  const ram = product.attributes.ram.replace(/\s+(RAM|DDR\d?)$/i, '').trim()
  const ssd = product.attributes.ssd
    .replace(/\s+(SSD|NVMe|M\.2|HDD)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return [cpu, ram, ssd].filter(Boolean).join(' · ') || 'PC de sobremesa'
}

interface PassOptions {
  skip?: 'cpuFamilies' | 'rams' | 'ssds' | 'brands'
}

function numeric(value: string): number | null {
  const text = value.trim().replace(',', '.')
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

export function passesFilters(
  product: Product,
  filters: Filters,
  favorites: Set<string>,
  options: PassOptions = {}
): boolean {
  if (!filters.showDiscontinued && product.isDiscontinued) return false
  if (filters.onlyFavorites && !favorites.has(product.sku)) return false

  const search = filters.search.trim().toLowerCase()
  if (search) {
    const haystack = `${product.name} ${product.shortName} ${product.attributes.cpu} ${product.attributes.marca}`.toLowerCase()
    if (!haystack.includes(search)) return false
  }

  const minPrice = numeric(filters.minPrice)
  const maxPrice = numeric(filters.maxPrice)
  if (minPrice !== null && (product.currentPrice === null || product.currentPrice < minPrice)) return false
  if (maxPrice !== null && (product.currentPrice === null || product.currentPrice > maxPrice)) return false

  if (options.skip !== 'cpuFamilies' && filters.cpuFamilies.length) {
    if (!filters.cpuFamilies.includes(product.cpuFamily)) return false
  }
  if (options.skip !== 'rams' && filters.rams.length) {
    if (!filters.rams.includes(product.attributes.ram)) return false
  }
  if (options.skip !== 'ssds' && filters.ssds.length) {
    if (!filters.ssds.includes(product.attributes.ssd)) return false
  }
  if (options.skip !== 'brands' && filters.brands.length) {
    if (!filters.brands.includes(product.attributes.marca)) return false
  }

  if (filters.onlyDiscount && !(product.discountPvpr !== null && product.discountPvpr > 0)) return false
  if (filters.onlyMin && !isAtHistoricalMin(product)) return false
  if (filters.onlyRecentDrop && !(product.deltaPct !== null && product.deltaPct < 0)) return false
  return true
}

export function filterProducts(
  products: Product[],
  filters: Filters,
  favorites: Set<string>
): Product[] {
  return products.filter((product) => passesFilters(product, filters, favorites))
}

export function sortProducts(products: Product[], sort: SortKey): Product[] {
  const sorted = [...products]
  sorted.sort((a, b) => {
    switch (sort) {
      case 'recent-drop':
        return (a.deltaPct ?? Infinity) - (b.deltaPct ?? Infinity)
      case 'recent-rise':
        return (b.deltaPct ?? -Infinity) - (a.deltaPct ?? -Infinity)
      case 'price-asc':
        return (a.currentPrice ?? Infinity) - (b.currentPrice ?? Infinity)
      case 'price-desc':
        return (b.currentPrice ?? -Infinity) - (a.currentPrice ?? -Infinity)
      case 'pvpr-discount':
        return (b.discountPvpr ?? -1) - (a.discountPvpr ?? -1)
      case 'near-min': {
        const score = (product: Product) => {
          if (product.currentPrice === null || product.minPriceHistorico === null) return Infinity
          if (product.numDiasHistorial < 2) return Infinity
          return (product.currentPrice - product.minPriceHistorico) / Math.max(1, product.minPriceHistorico)
        }
        return score(a) - score(b)
      }
      case 'name':
      default:
        return a.shortName.localeCompare(b.shortName, 'es')
    }
  })
  return sorted
}

export const CPU_FAMILY_ORDER = [
  'Ryzen 5',
  'Ryzen 7',
  'Ryzen 9',
  'Core i3',
  'Core i5',
  'Core i7',
  'Core i9',
  'Core Ultra 5',
  'Core Ultra 7',
  'Core Ultra 9',
]

function storageScore(value: string): number {
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*(TB|GB)/i)
  if (!match) return 0
  const size = Number(match[1].replace(',', '.'))
  return match[2].toUpperCase() === 'TB' ? size * 1024 : size
}

export interface FilterOption {
  value: string
  count: number
}

export type FilterGroup = 'cpuFamilies' | 'rams' | 'ssds' | 'brands'

export function filterOptions(
  products: Product[],
  filters: Filters,
  favorites: Set<string>,
  group: FilterGroup
): FilterOption[] {
  const base = products.filter((product) => passesFilters(product, filters, favorites, { skip: group }))
  const counts = new Map<string, number>()
  for (const product of base) {
    const value =
      group === 'cpuFamilies'
        ? product.cpuFamily
        : group === 'rams'
          ? product.attributes.ram
          : group === 'ssds'
            ? product.attributes.ssd
            : product.attributes.marca
    if (!value) continue
    counts.set(value, (counts.get(value) || 0) + 1)
  }

  const values = new Set<string>()
  for (const product of products) {
    const value =
      group === 'cpuFamilies'
        ? product.cpuFamily
        : group === 'rams'
          ? product.attributes.ram
          : group === 'ssds'
            ? product.attributes.ssd
            : product.attributes.marca
    if (value) values.add(value)
  }

  const list = [...values].map((value) => ({ value, count: counts.get(value) || 0 }))
  if (group === 'cpuFamilies') {
    return list
      .filter((option) => CPU_FAMILY_ORDER.includes(option.value))
      .sort((a, b) => CPU_FAMILY_ORDER.indexOf(a.value) - CPU_FAMILY_ORDER.indexOf(b.value))
  }
  if (group === 'rams' || group === 'ssds') {
    return list.sort((a, b) => storageScore(a.value) - storageScore(b.value) || a.value.localeCompare(b.value))
  }
  return list.sort((a, b) => a.value.localeCompare(b.value, 'es'))
}

export function countActiveFilters(filters: Filters): number {
  let count = 0
  if (filters.search.trim()) count += 1
  if (filters.minPrice.trim() || filters.maxPrice.trim()) count += 1
  count += filters.cpuFamilies.length
  count += filters.rams.length
  count += filters.ssds.length
  count += filters.brands.length
  if (filters.onlyDiscount) count += 1
  if (filters.onlyMin) count += 1
  if (filters.onlyRecentDrop) count += 1
  if (filters.onlyFavorites) count += 1
  if (filters.showDiscontinued) count += 1
  return count
}

export function applyCatalogParams(filters: Filters, params: CatalogParams): Filters {
  const next = { ...filters }
  if (params.min !== undefined || params.max !== undefined) {
    next.minPrice = params.min !== undefined ? String(params.min) : ''
    next.maxPrice = params.max !== undefined ? String(params.max) : ''
  }
  if (params.range) {
    const [min, max] = params.range.split('-').map(Number)
    if (Number.isFinite(min) && Number.isFinite(max)) {
      next.minPrice = String(min)
      next.maxPrice = String(max)
    }
  }
  return next
}

export interface Stats {
  total: number
  medianPrice: number | null
  minPrice: number | null
  maxPrice: number | null
  withDiscount: number
  discountShare: number
  days: number
  updated: string | null
  prevScrape: Scrape | null
  medianDeltaPct: number | null
  withPrice: number
}

export function datasetStats(dataset: Dataset): Stats {
  const active = activeProducts(dataset.products)
  const withPrice = active.filter((product) => product.currentPrice !== null)
  const prices = withPrice.map((product) => product.currentPrice as number)
  const medianPrice = median(prices)
  const scraper = dataset.meta.scrapes
  const prevScrape = scraper.length >= 2 ? scraper[scraper.length - 2] : null
  const medianDeltaPct =
    medianPrice !== null && prevScrape?.median != null && prevScrape.median > 0
      ? ((medianPrice - prevScrape.median) / prevScrape.median) * 100
      : null
  const withDiscount = active.filter((product) => (product.discountPvpr ?? 0) > 0).length
  return {
    total: active.length,
    medianPrice,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    withDiscount,
    discountShare: active.length ? (withDiscount / active.length) * 100 : 0,
    days: scraper.length,
    updated: dataset.meta.lastScrape
      ? `${dataset.meta.lastScrape} ${dataset.meta.lastScrapeTime || ''}`.trim()
      : latestUpdated(dataset.products),
    prevScrape,
    medianDeltaPct,
    withPrice: withPrice.length,
  }
}

function latestUpdated(products: Product[]): string | null {
  let latest: string | null = null
  for (const product of products) {
    if (product.lastUpdated && (!latest || product.lastUpdated > latest)) latest = product.lastUpdated
  }
  return latest
}

export interface Movement {
  product: Product
  abs: number
  pct: number
}

export function movements(products: Product[], direction: 'down' | 'up', limit = 8): Movement[] {
  const list = products
    .filter(
      (product) =>
        !product.isDiscontinued &&
        product.deltaPct !== null &&
        (direction === 'down' ? product.deltaPct < 0 : product.deltaPct > 0)
    )
    .map((product) => ({
      product,
      abs: product.deltaAbs ?? 0,
      pct: product.deltaPct as number,
    }))
  list.sort((a, b) => (direction === 'down' ? a.pct - b.pct : b.pct - a.pct))
  return list.slice(0, limit)
}

export interface RangeBucket {
  from: number
  to: number
  count: number
  isMedian: boolean
}

export function priceRanges(products: Product[], step = 250): RangeBucket[] {
  const active = products.filter((product) => !product.isDiscontinued && product.currentPrice !== null)
  const prices = active.map((product) => product.currentPrice as number)
  if (!prices.length) return []
  const medianPrice = median(prices)
  const start = Math.floor(Math.min(...prices) / step) * step
  const end = Math.ceil(Math.max(...prices) / step) * step
  const buckets: RangeBucket[] = []
  for (let from = start; from < end; from += step) {
    const to = from + step
    const count = prices.filter((price) => price >= from && (from + step === end ? price <= to : price < to)).length
    buckets.push({ from, to, count, isMedian: false })
  }
  while (buckets.length && buckets[0].count === 0) buckets.shift()
  while (buckets.length && buckets[buckets.length - 1].count === 0) buckets.pop()
  if (medianPrice !== null) {
    for (const bucket of buckets) {
      if (medianPrice >= bucket.from && medianPrice < bucket.to) {
        bucket.isMedian = true
        break
      }
    }
  }
  return buckets
}

export function priceBounds(products: Product[]): { min: number; max: number } {
  const prices = products
    .filter((product) => !product.isDiscontinued && product.currentPrice !== null)
    .map((product) => product.currentPrice as number)
  if (!prices.length) return { min: 0, max: 1000 }
  return {
    min: Math.floor(Math.min(...prices) / 10) * 10,
    max: Math.ceil(Math.max(...prices) / 10) * 10,
  }
}

export function priceHistogram(
  products: Product[],
  bins: number,
  min: number,
  max: number
): number[] {
  const counts = new Array(bins).fill(0)
  if (max <= min) return counts
  for (const product of products) {
    if (product.isDiscontinued || product.currentPrice === null) continue
    const ratio = (product.currentPrice - min) / (max - min)
    const index = Math.min(bins - 1, Math.max(0, Math.floor(ratio * bins)))
    counts[index] += 1
  }
  return counts
}

/* ------------------------------------------------------------------ */
/* Favoritos                                                           */
/* ------------------------------------------------------------------ */

const FAVORITES_KEY = 'pccom:favorites'

export function loadFavorites(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string'))
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

export function validDate(iso: string | null): boolean {
  return Boolean(parseISO(iso))
}
