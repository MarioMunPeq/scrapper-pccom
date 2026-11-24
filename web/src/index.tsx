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
    motivoMuestra: 'Datos insuficientes en el histórico real (< 3 días).',
  },
]

function usePrices() {
  const [prices, setPrices] = useState(initialPrices)
  const [showSampleWarning, setShowSampleWarning] = useState(true)

  useEffect(() => {
    const loadPrices = async () => {
      try {
        const res = await fetch('/data/prices.json')
        const data: any = await res.json()
        setPrices(data)
        setShowSampleWarning(false)
      } catch (e) {
        console.warn('No se pudo cargar prices.json', e)
        setShowSampleWarning(true)
      }
    }
    loadPrices()
  }, [])

  return { prices: prices as any, showSampleWarning }
}

function useFilters(prices: any[]) {
  const [search, setSearch] = useState<string>('')
  const [minPrice, setMinPrice] = useState<number>(0)
  const [maxPrice, setMaxPrice] = useState<number>(Infinity)
  const [onlyDiscount, setOnlyDiscount] = useState<boolean>(false)
  const [cpuFilter, setCpuFilter] = useState<string>('')
  const [ramFilter, setRamFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<string>('name')

  const filtered = prices.filter(function (p: any) {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    if (p.currentPrice < minPrice || p.currentPrice > maxPrice) return false
    if (onlyDiscount && (p.discount === null || p.discount === 0)) return false
    if (cpuFilter && !p.attributes.cpu.toLowerCase().includes(cpuFilter.toLowerCase())) return false
    if (ramFilter && !p.attributes.ram.toLowerCase().includes(ramFilter.toLowerCase())) return false
    return true
  })

  const sorted = prices.filter(function (p: any) {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    if (p.currentPrice < minPrice || p.currentPrice > maxPrice) return false
    if (onlyDiscount && (p.discount === null || p.discount === 0)) return false
    if (cpuFilter && !p.attributes.cpu.toLowerCase().includes(cpuFilter.toLowerCase())) return false
    if (ramFilter && !p.attributes.ram.toLowerCase().includes(ramFilter.toLowerCase())) return false
    return true
  }).sort(function (a: any, b: any) {
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
  var discount = p.discount ? '-' + p.discount + '%' : '-'
  var attrs = ''
  if (p.attributes) {
    var attrList: any[] = Object.entries(p.attributes).filter(function (kv: any[]) { return kv[1] })
    if (attrList.length > 0) {
      attrs = attrList.map(function (kv: any[]) { return kv[1] }).join(' | ')
    }
  }

  return React.createElement('div', { className: 'card', key: p.sku },
    React.createElement('div', { className: 'card-info' },
      React.createElement('h3', { className: 'card-name' }, p.name),
      React.createElement('div', { className: 'card-prices' },
        React.createElement('span', { className: 'card-current' }, p.currentPrice + ' €'),
        p.previousPrice && p.previousPrice !== p.currentPrice && React.createElement('span', { className: 'card-previous' }, p.previousPrice + ' €'),
        React.createElement('span', { className: 'card-discount' }, discount)
      ),
      attrs && React.createElement('span', { className: 'card-attrs' }, attrs)
    ),
    React.createElement('div', { className: 'card-hito' }, p.hito || '')
  )
}

function SampleWarning() {
  return React.createElement('div', { className: 'warning' },
    React.createElement('strong', null, 'DATOS DE EJEMPLO'),
    React.createElement('p', null,
      initialPrices[0]?.motivoMuestra || 'Histórico con menos de 3 días de datos.'
    )
  )
}

export default function App() {
  // @ts-ignore
  var _a: any[] = usePrices(), prices: any[] = _a[0], showSampleWarning: boolean = _a[1]
  // @ts-ignore
  var _b: any = useFilters(prices), search: any = _b.search, setSearch: any = _b.setSearch, minPrice: any = _b.minPrice, setMinPrice: any = _b.setMinPrice, maxPrice: any = _b.maxPrice, setMaxPrice: any = _b.setMaxPrice, onlyDiscount: any = _b.onlyDiscount, setOnlyDiscount: any = _b.setOnlyDiscount, cpuFilter: any = _b.cpuFilter, setCpuFilter: any = _b.setCpuFilter, ramFilter: any = _b.ramFilter, setRamFilter: any = _b.setRamFilter, sortBy: any = _b.sortBy, setSortBy: any = _b.setSortBy, sorted: any[] = _b.sorted

  return React.createElement('main', { className: 'app' },
    React.createElement('section', { className: 'hero', 'aria-label': 'KPIs globales' },
      React.createElement('h1', null, 'pc-price-tracker'),
      React.createElement('p', null, 'Histórico de precios de PCs con RTX 5070'),
      React.createElement('div', { className: 'kpis' },
        React.createElement('div', { className: 'kpi' },
          React.createElement('span', null, prices.length + ' PCs'),
          React.createElement('span', null, 'total')
        ),
        React.createElement('div', { className: 'kpi' },
          React.createElement('span',
            prices.length > 0 ?
              (prices.reduce(function (sum: number, p: any) { return sum + p.currentPrice }, 0) / prices.filter(function (p: any) { return p.currentPrice }).length || 0)
              : 0
          ) + ' €',
          React.createElement('span', null, 'precio medio')
        ),
        React.createElement('div', { className: 'kpi' },
          React.createElement('span', null, Math.max.apply(Math, prices.map(function (p: any) { return p.currentPrice || 0 }))) + ' € mayor',
          React.createElement('span', null, 'precio máximo')
        ),
        React.createElement('div', { className: 'kpi' },
          React.createElement('span', null, Math.min.apply(Math, prices.map(function (p: any) { return p.currentPrice || Infinity })) || 0) + ' € mínimo',
          React.createElement('span', null, 'precio mínimo')
        ),
        React.createElement('div', { className: 'kpi' },
          React.createElement('span', null, Math.max.apply(Math, prices.map(function (p: any) { return p.discount || 0 }))) + '% mayor bajada',
          React.createElement('span', null, 'máxima rebaja')
        )
      )
    ),
    showSampleWarning && React.createElement(SampleWarning),

    React.createElement('section', { className: 'listado', 'aria-label': 'Listado de PCs' },
      React.createElement('h2', null, 'Lista de PCs'),
      React.createElement('div', { className: 'filtros' },
        React.createElement('input', { type: 'text', placeholder: 'Buscar...', value: search, onChange: function (e: any) { setSearch(e.target.value) } }),
        React.createElement('input', { type: 'number', min: '0', placeholder: 'Precio mínimo', value: minPrice, onChange: function (e: any) { setMinPrice(e.target.value ? parseFloat(e.target.value) : 0) } }),
        React.createElement('input', { type: 'number', min: '0', placeholder: 'Precio máximo', value: maxPrice, onChange: function (e: any) { setMaxPrice(e.target.value ? parseFloat(e.target.value) : Infinity) } }),
        React.createElement('select', { value: onlyDiscount, onChange: function (e: any) { setOnlyDiscount(e.target.value === 'true') } },
          React.createElement('option', { value: 'false' }, 'Mostrar todos'),
          React.createElement('option', { value: 'true' }, 'Solo con descuento')
        ),
        React.createElement('select', { value: cpuFilter, onChange: function (e: any) { setCpuFilter(e.target.value) } },
          React.createElement('option', { value: '' }, 'Todo CPU'),
          React.createElement('option', { value: 'Intel' }, 'Intel'),
          React.createElement('option', { value: 'AMD' }, 'AMD')
        ),
        React.createElement('select', { value: ramFilter, onChange: function (e: any) { setRamFilter(e.target.value) } },
          React.createElement('option', { value: '' }, 'Todo RAM'),
          React.createElement('option', { value: '16GB' }, '16GB'),
          React.createElement('option', { value: '32GB' }, '32GB')
        ),
        React.createElement('select', { value: sortBy, onChange: function (e: any) { setSortBy(e.target.value) } },
          React.createElement('option', { value: 'name' }, 'Nombre (A-Z)'),
          React.createElement('option', { value: 'price' }, 'Precio (menor/mayor)'),
          React.createElement('option', { value: 'discount' }, 'Descuento (mayor/menor)')
        )
      ),
      React.createElement('div', { className: 'lista' },
        sorted.length === 0 ?
          React.createElement('p', null, 'No hay productos con los filtros aplicados.') :
          sorted.map(function (p: any) { return React.createElement(PriceCard, { key: p.sku, p: p }) })
        // TODO: sorted.map(p => <PriceCard key={p.sku} p={p} />)
      )
    ),
    React.createElement('section', { className: 'ranking', 'aria-label': 'Rankings' },
      React.createElement('h2', null, 'Mayores bajadas'),
      // @ts-ignore
      React.createElement('p', null, prices.filter(function (p: any) { return p.discount && p.discount > 0 }).length + ' productos tienen descuento'),
      React.createElement('div', { className: 'ranking-lista' },
        prices.filter(function (p: any) { return p.discount && p.discount > 0 })
          .sort(function (a: any, b: any) { return (b.discount || 0) - (a.discount || 0) })
          .slice(0, 5).map(function (p: any) {
            return React.createElement('div', { key: p.sku, className: 'ranking-item' },
              React.createElement('span', null, p.name.split(' / ')[0].substring(0, 40) + '...'),
              React.createElement('span', null, p.discount + '%')
            )
          }
        )
      )
    )
  )
}