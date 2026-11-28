export type View = 'home' | 'catalog' | 'product' | 'favorites'

export interface CatalogParams {
  sort?: string
  min?: number
  max?: number
  range?: string
}

export interface Route {
  view: View
  sku: string | null
  catalog: CatalogParams | null
  hash: string
}

function parseQuery(raw: string): URLSearchParams {
  return new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw)
}

function catalogParams(query: URLSearchParams): CatalogParams {
  const params: CatalogParams = {}
  const sort = query.get('sort')
  if (sort) params.sort = sort
  const min = Number(query.get('min'))
  const max = Number(query.get('max'))
  if (Number.isFinite(min) && query.get('min') !== null) params.min = min
  if (Number.isFinite(max) && query.get('max') !== null) params.max = max
  const range = query.get('range')
  if (range) params.range = range
  return params
}

/** Rutas hash existentes + #/catalogo y #/favoritos. */
export function parseRoute(hash: string): Route {
  const clean = (hash || '').replace(/^#/, '')
  const [pathPart, queryPart = ''] = clean.split('?')
  const query = parseQuery(queryPart)

  if (pathPart === '/product' || pathPart.startsWith('/product/')) {
    let sku: string | null = null
    if (pathPart.startsWith('/product/')) {
      sku = decodeURIComponent(pathPart.slice('/product/'.length)) || null
    } else {
      sku = query.get('sku')
    }
    return { view: 'product', sku, catalog: null, hash }
  }

  if (pathPart === '/catalogo' || pathPart === '/listado' || pathPart.startsWith('/catalogo/')) {
    return { view: 'catalog', sku: null, catalog: catalogParams(query), hash }
  }

  if (pathPart === '/favoritos' || pathPart.startsWith('/favoritos')) {
    return { view: 'favorites', sku: null, catalog: null, hash }
  }

  return { view: 'home', sku: null, catalog: null, hash }
}

export function productHref(sku: string): string {
  return `#/product/${encodeURIComponent(sku)}`
}

export const HREFS = {
  home: '#/',
  catalog: '#/catalogo',
  favorites: '#/favoritos',
}

export function catalogHref(params?: CatalogParams & { range?: string }): string {
  if (!params) return HREFS.catalog
  const query = new URLSearchParams()
  if (params.sort) query.set('sort', params.sort)
  if (params.min !== undefined) query.set('min', String(params.min))
  if (params.max !== undefined) query.set('max', String(params.max))
  if (params.range) query.set('range', params.range)
  const text = query.toString()
  return text ? `${HREFS.catalog}?${text}` : HREFS.catalog
}

export function navActive(view: View): 'home' | 'catalog' | 'favorites' | null {
  if (view === 'home') return 'home'
  if (view === 'catalog' || view === 'product') return 'catalog'
  if (view === 'favorites') return 'favorites'
  return null
}
