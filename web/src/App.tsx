import React, { useState, useEffect, useRef, useCallback } from 'react'

import './style.css'

// SIN initialPrices - NUNCA datos inventados ni de reserva

// ============================================================
// HOOK: Cargar precios desde el build script-generated prices.json
// ============================================================

function usePrices() {
  const [prices, setPrices] = useState<any[]>([])
  const [showError, setShowError] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const mountedRef = useRef(true)

  useEffect(() => {
    const loadPrices = async () => {
      try {
        const baseUrl = import.meta.env.BASE_URL
        const res = await fetch(baseUrl + 'data/prices.json')

        if (!res.ok) {
          throw new Error('Error ' + res.status + ' al cargar prices.json')
        }

        const data: any[] = await res.json()

        // Verificar si los datos son válidos
        if (!Array.isArray(data)) {
          throw new Error('Formato de datos inválido: expected array')
        }

        // Filtrar solo productos con datos reales y precio actual
        const validProducts = data.filter(function (p: any) {
          return p.datosReales && p.currentPrice !== null
        })

        setPrices(validProducts)
        setShowError(false)
      } catch (e: any) {
        console.warn('Error cargando prices.json', e)
        setShowError(true)
        setErrorMessage(e.message || 'Error desconocido cargando los datos')
      }
    }
    loadPrices()
    return () => { mountedRef.current = false }
  }, [])

  return { prices, showError, errorMessage }
}

// ============================================================
// HOOK: Filtros y ordenamiento
// ============================================================

function useFilters(prices: any[]) {
  const [search, setSearch] = useState<string>('')
  const [minPrice, setMinPrice] = useState<number>(0)
  const [maxPrice, setMaxPrice] = useState<number>(Infinity)
  const [onlyDiscount, setOnlyDiscount] = useState<boolean>(false)
  const [cpuFilter, setCpuFilter] = useState<string>('')
  const [ramFilter, setRamFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'discount'>('name')
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | '6m' | '1y' | 'all'>(
    'all'
  )

  const filtered = prices.filter(function (p: any) {
    // Búsqueda de texto
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false

    // Filtro de precio actual
    if (p.currentPrice < minPrice || p.currentPrice > maxPrice) return false

    // Solo mostrar con descuento
    if (onlyDiscount && (p.discount === null || p.discount === 0)) return false

    // Filtro CPU
    if (cpuFilter && !p.attributes.cpu.toLowerCase().includes(cpuFilter.toLowerCase())) return false

    // Filtro RAM
    if (ramFilter && !p.attributes.ram.toLowerCase().includes(ramFilter.toLowerCase())) return false

    return true
  })

  // Ordenar
  const sorted = prices
    .filter(function (p: any) {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
      if (p.currentPrice < minPrice || p.currentPrice > maxPrice) return false
      if (onlyDiscount && (p.discount === null || p.discount === 0)) return false
      if (cpuFilter && !p.attributes.cpu.toLowerCase().includes(cpuFilter.toLowerCase())) return false
      if (ramFilter && !p.attributes.ram.toLowerCase().includes(ramFilter.toLowerCase())) return false
      return true
    })
    .sort(function (a: any, b: any) {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'price') return a.currentPrice - b.currentPrice
      if (sortBy === 'discount') {
        const aDisc = a.discount !== null ? a.discount : 0
        const bDisc = b.discount !== null ? b.discount : 0
        return bDisc - aDisc
      }
      return 0
    })

  return {
    search: search,
    setSearch: setSearch,
    minPrice: minPrice,
    setMinPrice: setMinPrice,
    maxPrice: maxPrice,
    setMaxPrice: setMaxPrice,
    onlyDiscount: onlyDiscount,
    setOnlyDiscount: setOnlyDiscount,
    cpuFilter: cpuFilter,
    setCpuFilter: setCpuFilter,
    ramFilter: ramFilter,
    setRamFilter: setRamFilter,
    sortBy: sortBy,
    setSortBy: setSortBy,
    timeRange: timeRange,
    setTimeRange: setTimeRange,
    sorted: sorted as any[],
  }
}

// ============================================================
// COMPONENT: PriceBadge - Indicador visual de tendencia
// ============================================================

function PriceBadge({ changePct }: { changePct: number | null }) {
  if (changePct === null) return null

  const isDrop = changePct > 0
  const changeLabel = isDrop ? `-${changePct}%` : `+${changePct}%`

  return (
    <span
      className={`price-badge ${isDrop ? 'price-badge--drop' : 'price-badge--increase'}`}
      title={changeLabel}
      aria-label={changeLabel}
    >
      <span>{changeLabel}</span>
    </span>
  )
}

// ============================================================
// COMPONENT: ProductCard - Tarjeta de producto en listing
// ============================================================

function ProductCard({ p, timeRange }: { p: any; timeRange: string }) {
  const changePct = p.priceChangePct !== undefined ? p.priceChangePct : p.discount !== null ? p.discount : null
  const isDrop = changePct > 0 || (p.previousPrice && p.previousPrice > p.currentPrice)

  // Formatear precio para display
  const formatPrice = function (price: any): string {
    if (price == null) return 'N/A'
    return price.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  }

  // Determinar flecha de tendencia
  let trendClass = 'up'
  let trendLabel = ''
  if (changePct !== null) {
    if (changePct > 0) {
      trendClass = 'down'
      trendLabel = `-${changePct}%`
    } else if (changePct < 0) {
      trendClass = 'up'
      trendLabel = `+${Math.abs(changePct)}%`
    } else {
      trendLabel = '—'
    }
  } else if (p.previousPrice && p.previousPrice > p.currentPrice) {
    trendClass = 'down'
    trendLabel = '-'
  } else if (p.previousPrice && p.previousPrice < p.currentPrice) {
    trendClass = 'up'
    trendLabel = '+'
  }

  // Especificaciones
  const specs = [
    { key: 'CPU', value: p.attributes.cpu || '—' },
    { key: 'RAM', value: p.attributes.ram || '—' },
    { key: 'SSD', value: p.attributes.ssd || '—' },
    { key: 'GPU', value: p.attributes.gpu || '—' },
  ]

  // Precio histórico más bajo
  let lowestPriceInfo = ''
  if (p.minPriceHistorico !== null) {
    lowestPriceInfo = formatPrice(p.minPriceHistorico)
  }

  // Última actualización
  let lastUpdated = ''
  if (p.numDiasHistorial && p.lastUpdated) {
    lastUpdated = `Actualizado ${p.lastUpdated}`
  } else if (p.numDiasHistorial) {
    lastUpdated = `Historial: ${p.numDiasHistorial} día(s)`
  }

  // Serie temporal visible según range
  let seriesLabels = ''
  if (p.priceSeries && p.priceSeries.length > 0) {
    const rangeFilters: Record<string, number> = {
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '6m': 180,
      '1y': 365,
      'all': 9999,
    }
    const days = rangeFilters[timeRange] || 9999
    const recentSeries = p.priceSeries.filter(
      (s: any) => new Date(s.fecha) >= new Date(Date.now() - days * 86400000)
    )
    if (recentSeries.length > 0) {
      seriesLabels = `${recentSeries.length} observaciones`
    }
  }

  // Clases del producto
  const cardClasses = ['product-card']
  if (isDrop) cardClasses.push('price-down')
  if (changePct !== null) cardClasses.push('has-trend')

  return (
    <div className={cardClasses.join(' ')} key={p.sku} aria-label={p.name}>
      <div className="product-card-image-wrapper">
        {p.image_url ? (
          <img
            className="product-card-image"
            src={p.image_url}
            alt={p.name}
            loading="lazy"
            onError={(e: any) => { e.target.style.visibility = 'hidden' }}
          />
        ) : (
          <div className="product-card-image" aria-hidden="true" />
        )}
      </div>
      <div className="product-card-body">
        <div className="product-card-header">
          <span className="product-card-sku">SKU: {p.sku}</span>
        </div>
        <h3 className="product-card-title" aria-label={p.name}>{p.name}</h3>
        <div className="product-card-price">
          <span className="product-card-current-price">
            {formatPrice(p.currentPrice)}
          </span>
          {changePct !== null && <PriceBadge changePct={changePct} />}
        </div>
        <div className="product-card-details">
          <div className="product-card-specs">
            {specs.map(function (s: any, i: number) {
              return (
                <span
                  key={i}
                  className="product-card-spec"
                  aria-label={s.key + ': ' + s.value}
                >
                  <span className="product-spec-label">{s.key}: </span>
                  <span className="product-spec-value">{s.value}</span>
                </span>
              )
            })}
          </div>
          {p.previousPrice !== null && p.previousPrice !== undefined ? (
            <div className="product-card-previous-price">
              Antes: {formatPrice(p.previousPrice)}
            </div>
          ) : null}
          <div className="product-card-trend">
            <span className={`product-card-trend-icon ${trendClass}`}>
              {trendClass === 'down' ? '▼' : '▲'}
            </span>
            <span className="product-card-trend-label">{trendLabel}</span>
          </div>
        </div>
      </div>
      <div className="product-card-footer">
        <a
          className="product-card-link"
          href={`#/product/${p.sku}`}
          aria-label={`Ver detalle de ${p.name}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Ver detalle
        </a>
        <span className="product-card-external">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            aria-hidden={true}
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
          PcComponentes
        </span>
      </div>
    </div>
  )
}

// ============================================================
// COMPONENT: ProductChart - Gráfico de precio interactivo
// ============================================================

function ProductChart({ p }: { p: any }) {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | '6m' | '1y' | 'all'>('all')
  const ref = useRef<any[]>([])
  useEffect(() => {
    ref.current = p.priceSeries
  }, [p.priceSeries])

  const rangeLabels: Record<string, string> = {
    '7d': '7 días',
    '30d': '30 días',
    '90d': '90 días',
    '6m': '6 meses',
    '1y': '1 año',
    'all': 'Todo el histórico',
  }

  const rangeDays: Record<string, number> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '6m': 180,
    '1y': 365,
    'all': 9999,
  }

  // Filtrar series según range
  const filtered = p.priceSeries.filter(
    (s: any) => {
      const d = new Date(s.fecha)
      const now = new Date()
      return d >= new Date(now.getTime() - (rangeDays[timeRange] || 9999) * 86400000)
    }
  )

  // Calcular min/max en el rango seleccionado
  const rangePrices = filtered.map((s: any) => s.precio).filter(
    (price: any) => price !== null
  )
  const minInRange = rangePrices.length > 0 ? Math.min(...rangePrices) : null
  const maxInRange = rangePrices.length > 0 ? Math.max(...rangePrices) : null
  const currentInRange = rangePrices.length > 0 ? rangePrices[rangePrices.length - 1] : null

  // Observación actual (la más reciente)
  const currentObservation = p.priceSeries[p.priceSeries.length - 1]

  // Determinar tendencia en el rango
  let priceTrend = 'stable'
  if (p.priceSeries.length >= 2) {
    const first = p.priceSeries[0].precio
    const last = p.priceSeries[p.priceSeries.length - 1].precio
    if (first && last && first !== last) {
      priceTrend = last > first ? 'up' : 'down'
    }
  }

  // Botones de range selector
  const rangeButtons = Object.keys(rangeLabels).map((range) => {
    const isActive = timeRange === range
    return (
      <button
        key={range}
        className={
          'range-btn ' + (isActive ? 'range-btn--active' : '')
        }
        onClick={() => setTimeRange(range as '7d' | '30d' | '90d' | '6m' | '1y' | 'all')}
        aria-pressed={isActive}
        aria-label={rangeLabels[range] + ' ' + (isActive ? 'seleccionado' : 'ver')}
        style={{
          padding: '0.5rem 1rem',
          fontSize: '0.75rem',
          background: isActive ? 'var(--accent-green)' : 'var(--card)',
          color: isActive ? 'var(--bg)' : 'var(--fg)',
          border: '1px solid ' + (isActive ? 'var(--accent-green)' : 'var(--border)'),
          borderRadius: '6px',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
      >
        {rangeLabels[range]}
      </button>
    )
  })

  // Has enough data for chart
  const hasEnoughData = filtered.length >= 2
  const hasSingleObservation = filtered.length === 1 && p.priceSeries.length < 3

  // Generar datos del chart SVG
  const chartMin = minInRange !== null ? minInRange : 0
  const chartMax = maxInRange !== null ? maxInRange : 4000

  return (
    <div
      className="product-chart"
      aria-label="Gráfico de precio histórico"
    >
      <div className="chart-toolbar">
        <h3>Historial de precios</h3>
        <p>
          Última observación: {currentObservation?.fecha || 'N/A'}
        </p>
        <p>
          Precio actual:{" "}
          {currentObservation?.precio?.toLocaleString('es-ES', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} €
        </p>
      </div>
      <div className="chart-ranges">{rangeButtons}</div>
      {hasEnoughData || hasSingleObservation ? (
        <svg
          className="product-chart-svg"
          viewBox="0 0 800 400"
          role="img"
          aria-label="Gráfico de evolución de precios"
          preserveAspectRatio="xMidYMid meet"
        >
          <rect width="800" height="400" fill="var(--chart-bg)" rx={4} />
          {/* Grid lines */}
          {Array.from({ length: 5 }, (_, i) => (
            <line
              key={i}
              x1={60}
              y1={80 + i * 64}
              x2={740}
              y2={80 + i * 64}
              stroke="var(--chart-grid)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          ))}
          <line
            x1={60}
            y1={80}
            x2={60}
            y2={340}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
          <line
            x1={60}
            y1={340}
            x2={740}
            y2={340}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
          {/* Línea de precios */}
          {filtered.length > 0 && (
            <path
              d={generatePricePath(filtered)}
              fill="none"
              stroke="var(--accent-green)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {/* Marcadores de precios */}
          {filtered.map((point: any, i: number) => {
            const x =
              60 +
              (i / Math.max(filtered.length - 1, 1)) * 680
            const y =
              80 -
              ((point.precio || 0) /
                (chartMax - chartMin || 4000)) *
                260
            if (y >= 80 && y <= 340) {
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={3}
                  fill={
                    point === currentObservation
                      ? 'var(--accent-green)'
                      : 'var(--fg)'
                  }
                  stroke="var(--bg)"
                  strokeWidth={1}
                />
              )
            }
            return null
          })}
          {/* Min/Max points en rango */}
          {minInRange !== null && (
            <circle
              cx={
                60 +
                (filtered.findIndex(
                  (s: any) => s.precio === minInRange
                ) / Math.max(filtered.length - 1, 1)) * 680
              }
              cy={80 - (minInRange / (chartMax - chartMin || 4000)) * 260}
              r={4}
              fill="var(--accent-red)"
              stroke="var(--bg)"
              strokeWidth={1}
            />
          )}
          {maxInRange !== null && (
            <circle
              cx={
                60 +
                (filtered.findIndex(
                  (s: any) => s.precio === maxInRange
                ) / Math.max(filtered.length - 1, 1)) * 680
              }
              cy={80 - (maxInRange / (chartMax - chartMin || 4000)) * 260}
              r={4}
              fill="var(--accent-green)"
              stroke="var(--bg)"
              strokeWidth={1}
            />
          )}
          {/* Current price point */}
          {currentObservation && currentObservation !== null && (
            <circle
              cx={
                60 +
                (p.priceSeries.length - 1) /
                  Math.max(p.priceSeries.length - 1, 1) *
                  680
              }
              cy={
                80 -
                (currentObservation.precio /
                  (chartMax - chartMin || 4000)) *
                  260
              }
              r={5}
              fill="var(--accent-soft-red)"
              stroke="var(--bg)"
              strokeWidth={2}
            />
          )}
          {/* Tooltip area */}
          <text
            x={60}
            y={360}
            fill="var(--fg)"
            fontSize={0.7}
            style={{ pointerEvents: 'none' }}
          >
            Precio:{" "}
            {currentObservation?.precio?.toLocaleString('es-ES') || '—'} |{" "}
            {currentObservation?.fecha || '—'}
          </text>
          {/* Leyenda mínima */}
          <text
            x={740}
            y={380}
            fill="var(--muted)"
            fontSize={0.65}
            textAnchor="end"
          >
            Mín:{' '}{minInRange?.toLocaleString('es-ES') || '—'} | Máx:{
            " "}{maxInRange?.toLocaleString('es-ES') || '—'}
          </text>
        </svg>
      ) : hasSingleObservation ? (
        <div className="empty-states empty-state">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden={true}
          >
            <circle cx={12} cy={12} r={10} />
            <line x1={8} y1={8} x2={16} y2={16} />
            <line x1={8} y1={16} x2={16} y2={8} />
          </svg>
          <p>Datos insuficientes para gráfico</p>
          <p>
            Se necesitan al menos 3 observaciones de precio para mostrar el
            chart histórico.
          </p>
        </div>
      ) : (
        <div className="empty-states empty-state">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden={true}
          >
            <circle cx={12} cy={12} r={10} />
            <line x1={8} y1={8} x2={16} y2={16} />
            <line x1={8} y1={16} x2={16} y2={8} />
          </svg>
          <p>Sin datos de precio histórico</p>
          <p>
            Este producto tiene menos de 2 observaciones de precio en el
            histórico.
          </p>
        </div>
      )}
    </div>
  )
}

function generatePricePath(series: any[]) {
  if (series.length < 2) return 'M 0 0'

  const width = 680
  const height = 260
  const priceRange =
    Math.max(...series.map((s: any) => s.precio)) -
    Math.min(...series.map((s: any) => s.precio))
  const pricePadding = priceRange > 0 ? priceRange * 0.1 : 100

  const minPrice = Math.min(...series.map((s: any) => s.precio)) - pricePadding
  const maxPrice = Math.max(...series.map((s: any) => s.precio)) + pricePadding

  const pathPoints = series.map((point, i) => {
    const x = 30 + (i / (series.length - 1)) * 650
    const y =
      height - ((point.precio || 0) - minPrice) / (maxPrice - minPrice) * height
    return `${x},${y}`
  })

  return 'M ' + pathPoints.join(' L')
}

// ============================================================
// COMPONENT: ProductDetail - Página de detalle de producto
// ============================================================

function ProductDetail({ sku }: { sku: string }) {
  const [product, setProduct] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    const loadProduct = async () => {
      try {
        const baseUrl = import.meta.env.BASE_URL
        const res = await fetch(baseUrl + 'data/prices.json')
        if (!res.ok) throw new Error('Error loading prices.json')

        const allProducts: any[] = await res.json()
        const productData = allProducts.find((p: any) => p.sku === sku)

        if (!productData) {
          throw new Error('Producto no encontrado: ' + sku)
        }

        setProduct(productData)
        setLoading(false)
      } catch (e: any) {
        console.error('Error cargando producto', e)
        setError(e.message || 'Error desconocido')
        setLoading(false)
      }
    }

    loadProduct()
  }, [sku])

  if (loading) {
    return <div className="loading-state">Cargando detalle del producto...</div>
  }

  if (error) {
    return (
      <div className="error-banner">
        <span>Error</span>
        <p>{error}</p>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="empty-state">
        <h3>Producto no encontrado</h3>
        <p>
          El producto con SKU {sku} no está en el catálogo.
        </p>
      </div>
    )
  }

  const {
    priceSeries,
    currentPrice,
    minPriceHistorico,
    maxPriceHistorico,
    totalRegistros,
    numDiasHistorial,
    hito,
    attributes,
    firstPrice,
    lastPrice,
  } = product

  // Calcular cambio desde primera observación
  let changeFromFirst: number | null = null
  if (firstPrice !== null && currentPrice !== null && firstPrice > currentPrice) {
    changeFromFirst = Math.round((firstPrice - currentPrice) / firstPrice * 100)
  } else if (firstPrice !== null && currentPrice !== null && firstPrice < currentPrice) {
    changeFromFirst = -Math.round((currentPrice - firstPrice) / firstPrice * 100)
  }

  // Calcular cambio 7d, 30d si hay datos
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const prices7d = priceSeries.filter(
    (s: any) => new Date(s.fecha) >= sevenDaysAgo
  )
  const prices30d = priceSeries.filter(
    (s: any) => new Date(s.fecha) >= thirtyDaysAgo
  )

  const change7d =
    prices7d.length >= 2
      ? (currentPrice -
          prices7d[prices7d.length - 2].precio) /
          prices7d[prices7d.length - 2].precio *
          100
      : null

  const change30d =
    prices30d.length >= 2
      ? (currentPrice -
          prices30d[prices30d.length - 2].precio) /
          prices30d[prices30d.length - 2].precio *
          100
      : null

  // Determinar clase de tendencia
  const trendClass =
    change7d !== null && change7d > 0
      ? 'price-down'
      : change7d !== null && change7d < 0
        ? 'price-up'
        : ''

  return (
    <main className="app product-detail-app">
      <header className="app-header product-header">
        <h1 className="display-title">{product.name}</h1>
        <p className="header-subtitle">Historial de precios · RTX 5070</p>
        <div className="product-header-actions">
          <a
            className="nav-link"
            href="#/"
            aria-label="Volver al listado"
          >
            Volver al listado
          </a>
          <span className="product-sku">SKU: {product.sku}</span>
        </div>
      </header>

      <section className="product-detail-section">
        <div className="product-specs-grid">
          <div className="spec-card">
            <h3>Especificaciones</h3>
            <p>CPU: {attributes.cpu || 'No especificada'}</p>
            <p>RAM: {attributes.ram || 'No especificada'}</p>
            <p>SSD: {attributes.ssd || 'No especificada'}</p>
            <p>GPU: {attributes.gpu || 'No especificada'}</p>
            <p>Marca: {attributes.marca || 'No especificada'}</p>
          </div>
          <div className="spec-card">
            <h3>Precio</h3>
            <p>
            Precio actual: {currentPrice !== null ? currentPrice.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : 'N/A'}
            </p>
            {changeFromFirst !== null && (
              <p>
                Variación desde el primer registro:{' '}
                {changeFromFirst > 0 ? '-' : '+'}{Math.abs(changeFromFirst)}%
              </p>
            )}
            <p>
              Mínimo histórico:
              {minPriceHistorico !== null ? minPriceHistorico.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : 'N/A'}
            </p>
            <p>
              Máximo histórico:
              {maxPriceHistorico !== null ? maxPriceHistorico.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : 'N/A'}
            </p>
            {firstPrice !== null && (
              <p>
                Precio inicial:
                {firstPrice.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'}
              </p>
            )}
            {lastPrice !== null && (
              <p>
                Última observación:
                {lastPrice.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'}
              </p>
            )}
            {numDiasHistorial !== undefined && numDiasHistorial > 0 && (
              <p>
                Duración del seguimiento: {numDiasHistorial} día(s)
              </p>
            )}
            {hito && (
              <p>Hito: {hito}</p>
            )}
          </div>
        </div>
      </section>

      <section className="product-chart-section">
        <h2>Gráfico de evolución de precios</h2>
        <ProductChart p={{ ...product, priceSeries: priceSeries }} />
        <p>
          Serie completa: {totalRegistros} observaciones{" "}
          {numDiasHistorial !== undefined ? ', ' + numDiasHistorial + ' día(s)' : ''}
        </p>
      </section>

      <section className="product-footer-section">
        <p>
          Precio primera observación:{" "}
          {firstPrice !== null ? firstPrice.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : 'N/A'}
        </p>
        <p>Última actualización: {product.lastUpdated || 'N/A'}</p>
        <hr />
        <a
          className="product-external-link"
          href={product.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ver producto en PcComponentes"
        >
          Ver en PcComponentes ·
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden={true}
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </a>
      </section>
    </main>
  )
}

// ============================================================
// MAIN APP con routing hash-based
// ============================================================

export default function MainApp() {
  const { prices, showError, errorMessage } = usePrices()
  const {
    search, setSearch,
    minPrice, setMinPrice,
    maxPrice, setMaxPrice,
    onlyDiscount, setOnlyDiscount,
    cpuFilter, setCpuFilter,
    ramFilter, setRamFilter,
    sortBy, setSortBy,
    timeRange, setTimeRange,
    sorted,
  } = useFilters(prices)

  // Filtrar solo productos con precios válidos para cálculos
  const validPrices = prices.filter(function (p: any) { return p.currentPrice !== null })
  const totalPCs = validPrices.length

  // Top productos con mayor descuento para el ranking de "Mayores bajadas"
  const topRankings = validPrices
    .filter(function (p: any) { return p.discount !== null && p.discount > 0 })
    .sort(function (a: any, b: any) { return (b.discount || 0) - (a.discount || 0) })
    .slice(0, 5)

  // Calcular el total de páginas
  const ITEMS_PER_PAGE = 48
  const totalPages = Math.ceil(totalPCs / ITEMS_PER_PAGE) || 1

  // Paginación state
  const [currentPage, setCurrentPage] = useState(1)

  // Calcular el rango de índices para la página actual
  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE
  const endIdx = startIdx + ITEMS_PER_PAGE
  const pageItems = validPrices.slice(startIdx, endIdx)

  // Manejar cambio de página
  const goToPage = useCallback(function (page: number) {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }, [totalPages])

  // Leer SKU de la URL para detail page
  const hash = window.location.hash
  const detailSku = hash ? hash.replace('#/product/', '') : ''

  // Efecto para cargar página de detalle
  useEffect(() => {
    if (detailSku) {
      const timer = setTimeout(() => {}, 100)
      return () => clearTimeout(timer)
    }
  }, [detailSku])

  // Función para cambiar de página de filtrado
  const handlePageChange = useCallback((newPage: number) => {
    setCurrentPage(newPage)
  }, [])

  // Clear filters
  const handleClearFilters = useCallback(() => {
    setSearch('')
    setMinPrice(0)
    setMaxPrice(Infinity)
    setOnlyDiscount(false)
    setCpuFilter('')
    setRamFilter('')
    setSortBy('name')
    setTimeRange('all')
  }, [])

  // Determine if we're on a detail page
  const isDetailPage = !!detailSku

  return (
    <main className="app">
      {/* Header */}
      <header className="app-header">
        <div className="header-container">
          <a
            className="header-brand"
            href="#/"
            aria-label="pc-price-tracker portada"
          >
            pc-price-tracker
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent-green)"
              strokeWidth={2}
              aria-hidden={true}
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
            </svg>
        </a>
          <p className="header-desc">
            Plataforma de seguimiento de precios en tiempo real para PCs gaming con RTX 5070 en PcComponentes
          </p>
          <div className="header-actions">
            <input
              className="search-input"
              type="text"
              placeholder="Buscar producto..."
              value={search}
              onChange={(e: any) => setSearch(e.target.value)}
              aria-label="Buscar producto"
            />
            {isDetailPage ? (
              <a
                className="nav-link"
                href="#/"
                aria-label="Ocultar detalle"
              >
                Ocultar detalle
              </a>
            ) : null}
          </div>
        </div>
      </header>

      {/* Visión general KPIs */}
      <section className="overview-section">
        <h2>Descripción general</h2>
        <p>Plataforma de seguimiento de precios para PCs gaming RTX 5070</p>
        <div className="metrics-grid">
          <div className="metric-card">
            <span className="valor">{totalPCs}</span>
            <span className="etiqueta">PCs seguidos</span>
          </div>
          <div className="metric-card">
            <span className="valor">
              {validPrices.filter(
                (p: any) => p.discount !== null && p.discount > 0
              ).length}
            </span>
            <span className="etiqueta">con descuento</span>
          </div>
          <div className="metric-card">
            {validPrices.length > 0 ? (
              (
                validPrices.reduce(
                  (sum: number, p: any) => sum + p.currentPrice,
                  0
                ) / validPrices.length
              ).toFixed(0) + ' €'
            ) : (
              '0 €'
            )}
            <span className="etiqueta">precio medio</span>
          </div>
          <div className="metric-card">
            {validPrices.length > 0 ? (
              Math.max.apply(
                Math,
                validPrices.map(function (p: any) { return p.currentPrice })
              ) || 0
            ) : (
              0
            )}
            <span className="etiqueta">precio máximo</span>
          </div>
          <div className="metric-card">
            {validPrices.length > 0 ? (
              Math.min.apply(
                Math,
                validPrices.map(function (p: any) { return p.currentPrice })
              ) || 0
            ) : (
              0
            )}
            <span className="etiqueta">precio mínimo</span>
          </div>
        </div>
      </section>

      {/* Sección de descubrimiento */}
      <section className="discovery-section">
        <h2>Descubrir productos</h2>
        <p>
          Busca y filtra los PCs gaming con RTX 5070 seguidos por esta plataforma.
        </p>
        <div className="filters-panel">
          <input
            className="range-input"
            type="range"
            min="0"
            max="10000"
            value="5000"
            onChange={(e: any) => setMinPrice(parseFloat(e.target.value) || 0)}
            aria-label="Precio mínimo rango"
          />
          <input
            className="range-input"
            type="range"
            min="0"
            max="10000"
            value="0"
            onChange={(e: any) => setMaxPrice(parseFloat(e.target.value) || Infinity)}
            aria-label="Precio máximo rango"
          />
          <select
            value={onlyDiscount ? 'true' : 'false'}
            onChange={(e: any) => setOnlyDiscount(e.target.value === 'true')}
          >
            <option value="false">Mostrar todos</option>
            <option value="true">Solo con descuento</option>
          </select>
          <select
            value={cpuFilter}
            onChange={(e: any) => setCpuFilter(e.target.value)}
          >
            <option value="">Todo CPU</option>
            <option value="Intel">Intel</option>
            <option value="AMD">AMD</option>
          </select>
          <select
            value={ramFilter}
            onChange={(e: any) => setRamFilter(e.target.value)}
          >
            <option value="">Todo RAM</option>
            <option value="16GB">16GB</option>
            <option value="32GB">32GB</option>
            <option value="64GB">64GB</option>
          </select>
          <select
            value={sortBy}
            onChange={(e: any) => setSortBy(e.target.value)}
          >
            <option value="name">Nombre (A-Z)</option>
            <option value="price">Precio (menor/mayor)</option>
            <option value="discount">Descuento (mayor/menor)</option>
          </select>
          <select
            value={timeRange}
            onChange={(e: any) => setTimeRange(e.target.value)}
          >
            <option value="7d">7 días</option>
            <option value="30d">30 días</option>
            <option value="90d">90 días</option>
            <option value="6m">6 meses</option>
            <option value="1y">1 año</option>
            <option value="all">Todo el histórico</option>
          </select>
          <button
            className="clear-filters-btn"
            onClick={handleClearFilters}
          >
            Borrar filtros
          </button>
        </div>
        {!isDetailPage && (
          <p className="result-count">
            {totalPCs} resultados
          </p>
        )}
      </section>

      {/* Listado de productos */}
      <section className="listings-section">
        <h2>Productos seguidos</h2>
        {pageItems.length > 0 ? (
          <div className="product-list-container">
            {pageItems.map(function (p: any) {
              return (
                <ProductCard key={p.sku} p={p} timeRange={timeRange} />
              )
            })}
          </div>
        ) : (
          <div className="no-results">
            <p>No se encontraron productos con los filtros aplicados.</p>
          </div>
        )}
      </section>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="pagination">
          <span className="pagination-info">
            Página {currentPage} de {totalPages}
          </span>
          <button
            className="pagination-btn"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Página anterior"
          >
            Anterior
          </button>
          <button
            className="pagination-btn"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            aria-label="Siguiente página"
          >
            Cargar más
          </button>
        </div>
      )}

      {/* Ranking de mayores bajadas */}
      <section className="section-ranking">
        <h2>Mayores bajadas</h2>
        {validPrices.length > 0 ? (
          <p>
            {validPrices.filter(
              (p: any) => p.discount !== null && p.discount > 0
            ).length} productos tienen descuento
          </p>
        ) : null}
        {topRankings.length > 0 ? (
          <div className="ranking-lista">
            {topRankings.map(function (p: any) {
              return (
                <div key={p.sku} className="ranking-item">
                  <span className="ranking-item-name">
                    {p.name.split(' / ')[0].substring(0, 35) + '...'}
                  </span>
                  <span className="ranking-item-percentage">
                    {(p.discount || 0)}%
                  </span>
                </div>
              )
            })}
          </div>
        ) : null}
    </section>
      {/* Página de detalle si hay SKU en el hash */}
      {isDetailPage ? (
        <div className="product-detail-container">
          <ProductDetail sku={detailSku} />
        </div>
      ) : null}
    </main>
  )
}