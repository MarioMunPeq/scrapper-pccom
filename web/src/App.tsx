import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Home from './pages/Home'
import Catalog from './pages/Catalog'
import Product from './pages/Product'
import Favorites from './pages/Favorites'
import SiteHeader from './components/SiteHeader'
import TabBar from './components/TabBar'
import SiteFooter from './components/SiteFooter'
import StaleStrip from './components/StaleStrip'
import {
  applyCatalogParams,
  defaultSort,
  initialFilters,
  loadDataset,
  loadFavorites,
  saveFavorites,
  SORT_ORDER,
  type Dataset,
  type Filters,
  type Meta,
  type SortKey,
} from './lib/data'
import { parseRoute, productHref, type Route } from './lib/router'
import {
  destroySmoothScroll,
  getLenis,
  gsap,
  initSmoothScroll,
  prefersReducedMotion,
} from './lib/motion'
import { formatDayMonth } from './lib/format'

const EMPTY_META: Meta = {
  generatedAt: '',
  lastScrape: null,
  lastScrapeTime: '',
  scrapes: [],
  totals: { entries: 0, active: 0, discontinued: 0, withPrice: 0, withPvpr: 0 },
}

function asSort(value: string | undefined, fallback: SortKey): SortKey {
  return value && (SORT_ORDER as string[]).includes(value) ? (value as SortKey) : fallback
}

function LoadingView() {
  return (
    <div className="page">
      <div className="container">
        <div className="skeleton" style={{ width: '58%', height: 64, marginTop: 24 }} />
        <div className="skeleton" style={{ width: '38%', height: 20, marginTop: 20 }} />
        <div className="product-grid" aria-hidden="true" style={{ marginTop: 40 }}>
          {Array.from({ length: 9 }, (_, index) => (
            <div className="card-skeleton" key={index}>
              <div className="skeleton" style={{ width: '42%', height: 12 }} />
              <div className="skeleton" style={{ width: '92%', height: 22 }} />
              <div className="skeleton" style={{ width: '70%', height: 22 }} />
              <div className="skeleton" style={{ width: 120, height: 32, marginTop: 'auto' }} />
            </div>
          ))}
        </div>
        <p className="mono-label" role="status" style={{ marginTop: 24 }}>
          Cargando precios e histórico…
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [filters, setFilters] = useState<Filters>({ ...initialFilters })
  const [sort, setSort] = useState<SortKey>('price-asc')
  const [page, setPage] = useState(1)
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites())
  const [originView, setOriginView] = useState<'home' | 'catalog' | 'favorites'>('catalog')

  const mainRef = useRef<HTMLElement>(null)
  const originRef = useRef<{ hash: string; y: number } | null>(null)
  const pendingRestore = useRef<{ hash: string; y: number } | null>(null)
  const previousRoute = useRef<Route>(route)
  const routeKey = `${route.view}-${route.sku ?? ''}`

  useEffect(() => {
    let cancelled = false
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'

    loadDataset()
      .then((data) => {
        if (cancelled) return
        setDataset(data)
        const current = parseRoute(window.location.hash)
        let nextSort = defaultSort(data.meta.scrapes)
        if (current.view === 'catalog' && current.catalog) {
          nextSort = asSort(current.catalog.sort, nextSort)
          setFilters((existing) => applyCatalogParams(existing, current.catalog!))
          setPage(1)
        }
        setSort(nextSort)
        setError(null)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Error desconocido al cargar los datos'
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    initSmoothScroll()
    return () => destroySmoothScroll()
  }, [])

  useEffect(() => {
    const onHashChange = () => {
      const next = parseRoute(window.location.hash)
      const previous = previousRoute.current
      previousRoute.current = next
      setRoute(next)

      if (next.view === 'catalog' && next.catalog) {
        setFilters((existing) => applyCatalogParams(existing, next.catalog!))
        if (next.catalog.sort) {
          setSort((current) => asSort(next.catalog!.sort, current))
        }
        setPage(1)
      }

      const origin = originRef.current
      const restore =
        pendingRestore.current ??
        (previous.view === 'product' && origin && origin.hash === next.hash ? origin : null)
      pendingRestore.current = null

      const applyScroll = () => {
        const lenis = getLenis()
        const y = restore ? restore.y : 0
        if (lenis) lenis.scrollTo(y, { immediate: true })
        else window.scrollTo(0, y)
      }
      requestAnimationFrame(() => requestAnimationFrame(applyScroll))
    }

    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const titles: Record<Route['view'], string> = {
      home: 'Resumen',
      catalog: 'Catálogo',
      product: 'Ficha de producto',
      favorites: 'Favoritos',
    }
    document.title = `${titles[route.view]} · tracker/5070`
  }, [route.view])

  useEffect(() => {
    const node = mainRef.current
    if (!node || prefersReducedMotion()) return
    gsap.fromTo(node, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' })
  }, [routeKey])

  const toggleFavorite = useCallback((sku: string) => {
    setFavorites((current) => {
      const next = new Set(current)
      if (next.has(sku)) next.delete(sku)
      else next.add(sku)
      saveFavorites(next)
      return next
    })
  }, [])

  const openProduct = useCallback((sku: string) => {
    const currentHash = window.location.hash || '#/'
    if (currentHash.startsWith('#/product/')) return
    originRef.current = { hash: currentHash, y: window.scrollY }
    setOriginView(
      currentHash.startsWith('#/favoritos')
        ? 'favorites'
        : currentHash === '#/' || currentHash === ''
          ? 'home'
          : 'catalog'
    )
    window.location.hash = productHref(sku)
  }, [])

  const backFromProduct = useCallback(() => {
    const origin = originRef.current
    if (origin && origin.hash !== window.location.hash) {
      pendingRestore.current = origin
      window.location.hash = origin.hash
      return
    }
    window.location.hash = '#/catalogo'
  }, [])

  const clearFilters = useCallback(() => {
    setFilters({ ...initialFilters })
    setPage(1)
  }, [])

  const changeSort = useCallback((next: SortKey) => {
    setSort(next)
    setPage(1)
  }, [])

  const products = dataset?.products ?? []
  const meta = dataset?.meta ?? EMPTY_META
  const history = dataset?.history ?? {}
  const selected =
    route.sku && dataset
      ? dataset.products.find((product) => product.sku === route.sku) ?? null
      : null
  const series = route.sku && history[route.sku] ? history[route.sku] : []
  const lastUpdated = dataset
    ? `${dataset.meta.lastScrape ?? ''} ${dataset.meta.lastScrapeTime ?? ''}`.trim() || null
    : null
  const backLabel =
    originView === 'home'
      ? 'Volver al resumen'
      : originView === 'favorites'
        ? 'Volver a favoritos'
        : 'Volver al catálogo'

  const content = useMemo(() => {
    if (loading) return <LoadingView />
    if (error) {
      return (
        <div className="page">
          <div className="container">
            <div className="fatal" role="alert">
              <p className="eyebrow">Error de datos</p>
              <h1>No se han podido cargar los precios.</h1>
              <p>{error}</p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => window.location.reload()}
              >
                Reintentar
              </button>
            </div>
          </div>
        </div>
      )
    }
    if (route.view === 'product') {
      return (
        <Product
          product={selected}
          series={series}
          isFavorite={route.sku ? favorites.has(route.sku) : false}
          backLabel={backLabel}
          onToggleFavorite={() => route.sku && toggleFavorite(route.sku)}
          onBack={backFromProduct}
        />
      )
    }
    if (route.view === 'catalog') {
      return (
        <Catalog
          products={products}
          meta={meta}
          filters={filters}
          sort={sort}
          favorites={favorites}
          page={page}
          onPageChange={setPage}
          onFiltersChange={setFilters}
          onSortChange={changeSort}
          onToggleFavorite={toggleFavorite}
          onOpenProduct={openProduct}
          onClearFilters={clearFilters}
        />
      )
    }
    if (route.view === 'favorites') {
      return (
        <Favorites
          products={products}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onOpenProduct={openProduct}
        />
      )
    }
    return <Home products={products} meta={meta} onOpenProduct={openProduct} />
  }, [
    loading,
    error,
    route.view,
    route.sku,
    products,
    meta,
    filters,
    sort,
    favorites,
    page,
    selected,
    series,
    backLabel,
    toggleFavorite,
    openProduct,
    backFromProduct,
    clearFilters,
    changeSort,
  ])

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>
      <SiteHeader
        view={route.view}
        favoritesCount={favorites.size}
        updatedLabel={meta.lastScrape ? formatDayMonth(meta.lastScrape) : null}
      />
      <StaleStrip lastScrape={meta.lastScrape} />
      <main id="main" ref={mainRef} data-route={route.view}>
        {content}
      </main>
      <SiteFooter lastUpdated={lastUpdated} />
      <TabBar view={route.view} favoritesCount={favorites.size} />
    </div>
  )
}
