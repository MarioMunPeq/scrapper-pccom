import { useEffect, useMemo, useRef, useState } from 'react'
import Detail from './pages/Detail'
import Home from './pages/Home'
import Listing from './pages/Listing'
import {
  filterProducts,
  initialFilters,
  loadFavorites,
  parseRoute,
  saveFavorites,
  sortProducts,
  type Filters,
  type HistoryMap,
  type Product,
  type Route,
} from './lib'

const DATA_BASE = import.meta.env.BASE_URL

function HomeIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M3 8.4L10 2.8l7 5.6V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M3 5h14M3 10h14M3 15h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function StarIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M10 2.4l2.3 4.8 5.3.8-3.8 3.7.9 5.3L10 14.5 5.3 17l.9-5.3L2.4 8l5.3-.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([])
  const [history, setHistory] = useState<HistoryMap>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [filters, setFilters] = useState<Filters>({ ...initialFilters })
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites())

  const savedScroll = useRef(0)
  const pendingScroll = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [pricesResponse, historyResponse] = await Promise.all([
          fetch(`${DATA_BASE}data/prices.json`, { cache: 'no-cache' }),
          fetch(`${DATA_BASE}data/history.json`, { cache: 'no-cache' }).catch(() => null),
        ])

        if (!pricesResponse.ok) {
          throw new Error(`No se pudo cargar prices.json (HTTP ${pricesResponse.status})`)
        }

        const pricesJson: unknown = await pricesResponse.json()
        if (!Array.isArray(pricesJson)) {
          throw new Error('prices.json no tiene el formato esperado')
        }

        let historyJson: HistoryMap = {}
        if (historyResponse && historyResponse.ok) {
          try {
            const parsed: unknown = await historyResponse.json()
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              historyJson = parsed as HistoryMap
            }
          } catch {
            historyJson = {}
          }
        }

        if (cancelled) return
        setProducts(pricesJson as Product[])
        setHistory(historyJson)
        setError(null)
      } catch (loadError) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Error desconocido al cargar los datos')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onHashChange = () => {
      const next = parseRoute(window.location.hash)
      setRoute(next)

      if (next.view === 'list' && pendingScroll.current !== null) {
        const y = pendingScroll.current
        pendingScroll.current = null
        requestAnimationFrame(() => {
          requestAnimationFrame(() => window.scrollTo(0, y))
        })
      } else {
        window.scrollTo(0, 0)
      }
    }

    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const names: Record<Route['view'], string> = {
      home: 'Resumen',
      list: 'Catálogo',
      detail: 'Ficha de producto',
    }
    document.title = `${names[route.view]} · Precios PcComponentes`
  }, [route])

  const filtered = useMemo(
    () => sortProducts(filterProducts(products, filters, favorites), filters.sort),
    [products, filters, favorites]
  )

  const selectedProduct = useMemo(
    () => (route.sku ? products.find((product) => product.sku === route.sku) ?? null : null),
    [products, route.sku]
  )

  const toggleFavorite = (sku: string) => {
    setFavorites((current) => {
      const next = new Set(current)
      if (next.has(sku)) next.delete(sku)
      else next.add(sku)
      saveFavorites(next)
      return next
    })
  }

  const rememberScroll = () => {
    savedScroll.current = window.scrollY
  }

  const goBackToList = () => {
    pendingScroll.current = savedScroll.current
    if (window.location.hash === '#/listado') {
      window.scrollTo(0, savedScroll.current)
      return
    }
    window.location.hash = '#/listado'
  }

  const openFavorites = () => {
    setFilters((current) => ({ ...current, onlyFavorites: true }))
    if (route.view !== 'list') window.location.hash = '#/listado'
    else window.scrollTo(0, 0)
  }

  const navItems = [
    { key: 'home', label: 'Resumen', href: '#/', icon: <HomeIcon />, active: route.view === 'home' },
    {
      key: 'list',
      label: 'Catálogo',
      href: '#/listado',
      icon: <ListIcon />,
      active: route.view === 'list' || route.view === 'detail',
    },
  ]

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>

      <nav className="rail" aria-label="Navegación principal">
        <a className="rail__brand" href="#/" aria-label="Inicio · Precios PcComponentes">
          <span className="rail__mark" aria-hidden="true">
            PC
          </span>
        </a>
        <div className="rail__links">
          {navItems.map((item) => (
            <a
              key={item.key}
              className={`rail__link${item.active ? ' is-active' : ''}`}
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
            </a>
          ))}
          <button
            type="button"
            className={`rail__link rail__link--button${
              route.view === 'list' && filters.onlyFavorites ? ' is-active' : ''
            }`}
            onClick={openFavorites}
          >
            <StarIcon />
            <span>Favoritos</span>
          </button>
        </div>
        <div className="rail__foot" aria-hidden="true">
          <span className="rail__count">{products.length || '—'}</span>
          <span className="rail__foot-label">PCs</span>
        </div>
      </nav>

      <main className="app__main" id="main">
        {error ? (
          <div className="page">
            <div className="empty empty--detail">
              <h1>No se han podido cargar los datos</h1>
              <p>{error}</p>
              <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
                Reintentar
              </button>
            </div>
          </div>
        ) : route.view === 'detail' ? (
          <Detail
            product={selectedProduct}
            series={route.sku && history[route.sku] ? history[route.sku] : []}
            loading={loading}
            isFavorite={route.sku ? favorites.has(route.sku) : false}
            onToggleFavorite={toggleFavorite}
            onBack={goBackToList}
          />
        ) : loading ? (
          <div className="page">
            <div className="skeleton-head" aria-hidden="true" />
            <p className="loading-note" role="status">
              Cargando catálogo e histórico…
            </p>
          </div>
        ) : route.view === 'list' ? (
          <Listing
            products={filtered}
            totalProducts={products.length}
            filters={filters}
            onFiltersChange={setFilters}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onOpenDetail={rememberScroll}
          />
        ) : (
          <Home products={products} history={history} />
        )}

        <footer className="site-foot">
          <span>Scrapper PcComponentes</span>
          <span className="site-foot__sep">·</span>
          <span>Precios con IVA, actualizados a diario</span>
          <span className="site-foot__sep">·</span>
          <span>{products.length} PCs monitorizados</span>
        </footer>
      </main>
    </div>
  )
}
