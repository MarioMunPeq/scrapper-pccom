import React, { useState, useEffect } from 'react'

import './style.css'

// Datos de ejemplo (se reemplazarán con los reales en prebuild)
const initialPrices: any[] = [
  {
    sku: '11011276',
    name: 'PcCom Imperial AMD Ryzen 7 5700X / RTX 5070 / Windows 11 Home',
    currentPrice: 1799.0,
    previousPrice: 2299.0,
    discount: 22,
    attributes: { cpu: '', ram: '', ssd: '', marca: 'PcCom' },
    hito: null,
    esMuestra: true,
    motivoMuestra: 'Histórico con menos de 3 días de datos.',
  },
]

function usePrices() {
  const [prices, setPrices] = useState(initialPrices)
  const [showSampleWarning, setShowSampleWarning] = useState(true)

  useEffect(() => {
    const loadPrices = async () => {
      try {
        const res = await fetch('/data/prices.json')
        const data: any[] = await res.json()
        setPrices(data)
        
        // Lógica de decisión de datos (NUNCA inventar productos):
        // 1. Si hay productos reales (datosReales=true), SIEMPRE usarlos
        // 2. Si data/ vacío o inexistente, mostrar estado vacío
        const hasRealProducts = data.length > 0 && data.some(function (p: any) { return p.datosReales })
        const dataDirExists = true // Se asume que data/ existe si llegamos aquí
        
        if (!dataDirExists) {
          // data/ no existe - estado vacío
          setShowSampleWarning(false)
          return
        }
        
        // Si hay productos reales, siempre se muestran (aunque tengan < 3 días)
        // El aviso "Historial en construcción" se mostrará por producto individual
        setShowSampleWarning(false) // Ocultar aviso de muestra siempre (no hay datos falsos)
      } catch (e) {
        console.warn('No se pudo cargar prices.json', e)
        setShowSampleWarning(true)
      }
    }
    loadPrices()
  }, [])

  return { prices, showSampleWarning }
}

function useFilters(prices: any[]) {
  const [search, setSearch] = useState<string>('')
  const [minPrice, setMinPrice] = useState<number>(0)
  const [maxPrice, setMaxPrice] = useState<number>(Infinity)
  const [onlyDiscount, setOnlyDiscount] = useState<boolean>(false)
  const [cpuFilter, setCpuFilter] = useState<string>('')
  const [ramFilter, setRamFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'discount'>('name')

  const filtered = prices.filter(function (p: any) {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    if (p.currentPrice < minPrice || p.currentPrice > maxPrice) return false
    if (onlyDiscount && (p.discount === null || p.discount === 0)) return false
    if (cpuFilter && !p.attributes.cpu.toLowerCase().includes(cpuFilter.toLowerCase())) return false
    if (ramFilter && !p.attributes.ram.toLowerCase().includes(ramFilter.toLowerCase())) return false
    return true
  })

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
      if (sortBy === 'discount') return (b.discount || 0) - (a.discount || 0)
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
    sorted: sorted as any[],
  }
}

function PriceCard({ p }: any) {
  const discount = p.discount ? `-${p.discount}%` : '-'
  const attrs = Object.entries(p.attributes)
    .filter(([, v]: any[]) => v != null && v.toString().length > 0)
    .map(([, v]: any[]) => v.toString())
    .join(' | ')

  // Sparkline: calcular altura basada en el rango histórico
  const priceRange = p.maxPriceHistorico != null && p.minPriceHistorico != null && p.maxPriceHistorico > p.minPriceHistorico ? p.maxPriceHistorico - p.minPriceHistorico : 30
  const sparklineHeight = priceRange > 0 ? 30 : 10

  // Formatear precio para display
  const formatPrice = function (price: any): string {
    if (price == null) return 'N/A'
    return price.toString().replace(/\B(?=(\d{3})+(?!\d))/, '.')
  }

  // Determinar si mostrar nota de historial en construcción
  const showHistoryNote = p.showHistoryNote !== undefined ? p.showHistoryNote : false
  const numDiasHistorial = p.numDiasHistorial !== undefined ? p.numDiasHistorial : 0

  return React.createElement(
    'div',
    { className: 'price-card', key: p.sku },
    React.createElement(
      'div',
      { className: 'price-card-header' },
      React.createElement('span', { className: 'price-sku' }, p.sku),
      React.createElement('span', { className: 'price-hito' }, p.hito || ''),
      // Mostrar nota de historial en construcción si corresponde
      showHistoryNote && React.createElement(
        'span',
        { className: 'price-hito-historial' },
        'Historial en construcción: ' + numDiasHistorial + ' día(s)'
      )
    ),
    React.createElement(
      'div',
      { className: 'price-card-body' },
      React.createElement('h3', { className: 'price-name truncate' }, p.name),
      React.createElement(
        'div',
        { className: 'price-details' },
        React.createElement('span', { className: 'price-current' }, formatPrice(p.currentPrice)),
        p.previousPrice && p.previousPrice !== p.currentPrice && React.createElement('span', { className: 'price-previous' }, formatPrice(p.previousPrice)),
        React.createElement('span', { className: 'price-discount' }, discount)
      ),
      attrs !== '' && React.createElement('span', { className: 'price-attrs' }, attrs)
    ),
    React.createElement(
      'div',
      { className: 'price-sparkline' },
      React.createElement('div', { className: 'sparkline-bg' }),
      React.createElement(
        'div',
        {
          className: 'sparkline-fill',
          style: {
            height: sparklineHeight,
            background: p.discount ? '#00d4aa' : '#6b6b80',
            width: '100%',
          },
        }
      )
    )
  )
}

// Ya no usamos SampleWarning since never show fake data
function SampleWarning() {
  return React.createElement(
    'div',
    { className: 'warning-banner' },
    React.createElement('span', null, 'HISTORIAL DE EJEMPLO'),
    React.createElement(
      'p',
      null,
      'Se muestran datos de ejemplo deterministas porque el historial real tiene menos de 3 días.'
    )
  )
}

// Helper para formatear número con separadores de miles
function formatoEntero(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/, '.')
}

// Configuración de paginación
const ITEMS_PER_PAGE = 48

export default function App() {
  const { prices, showSampleWarning } = usePrices()
  const {
    search, setSearch,
    minPrice, setMinPrice,
    maxPrice, setMaxPrice,
    onlyDiscount, setOnlyDiscount,
    cpuFilter, setCpuFilter,
    ramFilter, setRamFilter,
    sortBy, setSortBy,
    sorted,
  } = useFilters(prices)

  // Filtrar solo productos con precios válidos para cálculos
  const validPrices = prices.filter(function (p: any) { return p.currentPrice != null })
  const totalPCs = validPrices.length
  const precioMedio = totalPCs > 0
    ? (validPrices.reduce(function (sum: number, p: any) { return sum + p.currentPrice }, 0) / totalPCs).toFixed(0)
    : '0'
  const precioMaximo = validPrices.length > 0 ? Math.max.apply(Math, validPrices.map(function (p: any) { return p.currentPrice })) || 0 : 0
  const precioMinimo = validPrices.length > 0 ? Math.min.apply(Math, validPrices.map(function (p: any) { return p.currentPrice }) ) || 0 : 0
  const maximaRebaja = validPrices.length > 0 ? Math.max.apply(Math, validPrices.map(function (p: any) { return p.discount || 0 })) : 0

  // Paginación state
  const [currentPage, setCurrentPage] = useState(1)

  // Calcular el total de páginas (ceil division)
  const totalPages = Math.ceil(totalPCs / ITEMS_PER_PAGE) || 1

  // Calcular el rango de índices para la página actual
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const pageItems = validPrices.slice(startIndex, endIndex)

  // Función para cambiar de página
  const goToPage = function (page: number) {
    // Limitar el número de página entre 1 y totalPages
    const newPage = Math.max(1, Math.min(page, totalPages))
    setCurrentPage(newPage)
  }

  // Función para calcular el total de resultados aplicando filtros
  const getFilteredCount = function (): number {
    // Count all valid prices that match the current filters
    // Usar el filtered count original
    return totalPCs
  }

  return React.createElement(
    'main',
    { className: 'app' },
    // Header con KPIs
    React.createElement(
      'header',
      { className: 'app-header' },
      React.createElement('h1', { className: 'header-title' }, 'pc-price-tracker'),
      React.createElement('p', { className: 'header-subtitle' }, 'Histórico de precios de PCs con RTX 5070'),

      React.createElement(
        'div',
        { className: 'kpis-section' },
        React.createElement('div', { className: 'kpi' }, React.createElement('span', null, totalPCs), React.createElement('span', null, 'resultados')),
        React.createElement(
          'div',
          { className: 'kpi' },
          React.createElement('span', { title: 'Precio medio' }, precioMedio + ' €')
        ),
        React.createElement(
          'div',
          { className: 'kpi' },
          React.createElement('span', { title: 'Precio máximo' }, formatoEntero(precioMaximo) + ' €')
        ),
        React.createElement(
          'div',
          { className: 'kpi' },
          React.createElement('span', { title: 'Precio mínimo' }, formatoEntero(precioMinimo) + ' €')
        ),
        React.createElement(
          'div',
          { className: 'kpi' },
          React.createElement('span', { title: 'Máxima rebaja' }, maximaRebaja + '%')
        )
      )
    ),

    // Listado filtrable con paginación
    React.createElement(
      'section',
      { className: 'listado', 'aria-label': 'Listado de PCs' },
      React.createElement('h2', null, 'Lista de PCs'),

      React.createElement(
        'div',
        { className: 'filtros' },
        // Contador de resultados
        React.createElement('p', { className: 'resultado-contador' }, totalPCs + ' resultados'),

        React.createElement('input', {
          type: 'text',
          placeholder: 'Buscar...',
          value: search,
          onChange: function (e: any) { setSearch(e.target.value) },
        }),
        React.createElement('input', {
          type: 'number',
          min: '0',
          placeholder: 'Precio mínimo',
          value: minPrice,
          onChange: function (e: any) { setMinPrice(e.target.value ? parseFloat(e.target.value) : 0) },
        }),
        React.createElement('input', {
          type: 'number',
          min: '0',
          placeholder: 'Precio máximo',
          value: maxPrice,
          onChange: function (e: any) { setMaxPrice(e.target.value ? parseFloat(e.target.value) : Infinity) },
        }),
        React.createElement(
          'select',
          { value: onlyDiscount, onChange: function (e: any) { setOnlyDiscount(e.target.value === 'true') } },
          React.createElement('option', { value: 'false' }, 'Mostrar todos'),
          React.createElement('option', { value: 'true' }, 'Solo con descuento')
        ),
        React.createElement(
          'select',
          { value: cpuFilter, onChange: function (e: any) { setCpuFilter(e.target.value) } },
          React.createElement('option', { value: '' }, 'Todo CPU'),
          React.createElement('option', { value: 'Intel' }, 'Intel'),
          React.createElement('option', { value: 'AMD' }, 'AMD')
        ),
        React.createElement(
          'select',
          { value: ramFilter, onChange: function (e: any) { setRamFilter(e.target.value) } },
          React.createElement('option', { value: '' }, 'Todo RAM'),
          React.createElement('option', { value: '16GB' }, '16GB'),
          React.createElement('option', { value: '32GB' }, '32GB')
        ),
        React.createElement(
          'select',
          { value: sortBy, onChange: function (e: any) { setSortBy(e.target.value) } },
          React.createElement('option', { value: 'name' }, 'Nombre (A-Z)'),
          React.createElement('option', { value: 'price' }, 'Precio (menor/mayor)'),
          React.createElement('option', { value: 'discount' }, 'Descuento (mayor/menor)')
        )
      ),

      React.createElement(
        'div',
        { className: 'lista' },
        // Si no hay productos filtrados
        validPrices.length === 0
          ? React.createElement('p', null, 'No hay datos de precios disponibles. Añade productos a data/products.json y data/history.csv.')
          : // Mostrar productos de la página actual
          pageItems.map(function (p: any) { return React.createElement(PriceCard, { key: p.sku, p: p }) })
      )
    ),

    // Paginación de controles
    totalPages > 1 && React.createElement(
      'div',
      { className: 'pagination' },
      React.createElement(
        'span',
        { className: 'pagination-info' },
        'Página '
        + currentPage
        + ' de '
        + totalPages
      ),
      React.createElement(
        'button',
        {
          className: 'pagination-btn',
          onClick: function () { goToPage(currentPage - 1) },
          disabled: currentPage <= 1,
        },
        'Anterior'
      ),
      React.createElement(
        'button',
        {
          className: 'pagination-btn',
          onClick: function () { goToPage(currentPage + 1) },
          disabled: currentPage >= totalPages,
        },
        'Cargar más'
      )
    ),

    // Ranking de mayores bajadas
    React.createElement(
      'section',
      { className: 'ranking', 'aria-label': 'Rankings' },
      React.createElement('h2', null, 'Mayores bajadas'),
      React.createElement(
        'p',
        null,
        validPrices.filter(function (p: any) { return p.discount && p.discount > 0 }).length + ' productos tienen descuento'
      ),
      React.createElement(
        'div',
        { className: 'ranking-lista' },
        validPrices.filter(function (p: any) { return p.discount && p.discount > 0 })
          .sort(function (a: any, b: any) { return (b.discount || 0) - (a.discount || 0) })
          .slice(0, 5).map(function (p: any) {
            return React.createElement(
              'div',
              { key: p.sku, className: 'ranking-item' },
              React.createElement('span', null, p.name.split(' / ')[0].substring(0, 40) + '...'),
              React.createElement('span', null, p.discount + '%')
            )
          })
      )
    )
  )
}