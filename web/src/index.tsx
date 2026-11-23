import React, { useState, useEffect } from 'react'
import './style.css'

// Datos de ejemplo (se reemplazarán con los reales en prebuild)
const initialPrices = [
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
    // En producción, el script de build ya habrá generado prices.json
    // y podemos cargarlo aquí. Por ahora, usamos los datos iniciales.
    const loadPrices = async () => {
      try {
        const res = await fetch('/data/prices.json')
        const data = await res.json()
        setPrices(data)
        setShowSampleWarning(false)
      } catch (e) {
        console.warn('No se pudo cargar prices.json', e)
        setShowSampleWarning(true)
      }
    }
    loadPrices()
  }, [])

  return { prices, showSampleWarning }
}

function useFilters() {
  const [search, setSearch] = useState('')
  const [minPrice, setMinPrice] = useState(0)
  const [maxPrice, setMaxPrice] = useState(Infinity)
  const [onlyDiscount, setOnlyDiscount] = useState(false)
  const [cpuFilter, setCpuFilter] = useState('')
  const [ramFilter, setRamFilter] = useState('')
  const [sortBy, setSortBy] = useState('name')

  const filtered = prices.filter(p => {
    // Búsqueda en nombre
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    // Rango de precio
    if (p.currentPrice < minPrice || p.currentPrice > maxPrice) return false
    // Solo con descuento
    if (onlyDiscount && (p.discount === null || p.discount === 0)) return false
    // Filtro CPU
    if (cpuFilter && !p.attributes.cpu.toLowerCase().includes(cpuFilter.toLowerCase())) return false
    // Filtro RAM
    if (ramFilter && !p.attributes.ram.toLowerCase().includes(ramFilter.toLowerCase())) return false
    return true
  })

  // Ordenar
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'price') return a.currentPrice - b.currentPrice
    if (sortBy === 'discount') return (b.discount || 0) - (a.discount || 0)
    return 0
  })

  return {
    search, setSearch,
    minPrice, setMinPrice,
    maxPrice, setMaxPrice,
    onlyDiscount, setOnlyDiscount,
    cpuFilter, setCpuFilter,
    ramFilter, setRamFilter,
    sortBy, setSortBy,
    sorted,
  }
}

function PriceCard({ p }) {
  const discount = p.discount ? `-${p.discount}%` : '-'
  const attributes = Object.entries(p.attributes)
    .filter(([k, v]) => v)
    .map(([k, v]) => v)
    .join(' | ')

  return (
    <div className="card" key={p.sku}>
      <div className="card-info">
        <h3 className="card-name">{p.name}</h3>
        <div className="card-prices">
          <span className="card-current">{p.currentPrice} €</span>
          {p.previousPrice && p.previousPrice !== p.currentPrice && (
            <span className="card-previous">{p.previousPrice} €</span>
          )}
          <span className="card-discount">{discount}</span>
        </div>
        {attributes && <span className="card-attrs">{attributes}</span>}
      </div>
      <div className="card-hito">{p.hito || ''}</div>
    </div>
  )
}

function SampleWarning() {
  return (
    <div className="warning">
      <strong>DATOS DE EJEMPLO</strong>
      <p>
        {initialPrices[0]?.motivoMuestra || 'Histórico con menos de 3 días de datos.'}
      </p>
    </div>
  )
}

export default function Home() {
  const { prices: allPrices, showSampleWarning } = usePrices()
  const {
    search, setSearch,
    minPrice, setMinPrice,
    maxPrice, setMaxPrice,
    onlyDiscount, setOnlyDiscount,
    cpuFilter, setCpuFilter,
    ramFilter, setRamFilter,
    sortBy, setSortBy,
    sorted,
  } = useFilters()

  return (
    <main className="app">
      {/* Hero section */}
      <section className="hero" aria-label="KPIs globales">
        <h1>pc-price-tracker</h1>
        <p>Histórico de precios de PCs con RTX 5070</p>

        {/* KPIs */}
        <div className="kpis">
          <div className="kpi">
            <span>{allPrices.length} PCs</span>
            <span>total</span>
          </div>
          <div className="kpi">
            <span>
              {allPrices.reduce((sum, p) => sum + (p.currentPrice || 0), 0) /
                allPrices.filter(p => p.currentPrice).length ||
                0}
              € median</span>
            <span>precio medio</span>
          </div>
          <div className="kpi">
            <span>{Math.max(...allPrices.map(p => p.currentPrice || 0))} € mayor</span>
            <span>precio máximo</span>
          </div>
          <div className="kpi">
            <span>{Math.min(...allPrices.map(p => p.currentPrice || Infinity)) || 0} € mínimo</span>
            <span>precio mínimo</span>
          </div>
          <div className="kpi">
            <span>{Math.max(...allPrices.map(p => p.discount || 0))}% mayor bajada</span>
            <span>máxima rebaja</span>
          </div>
        </div>
      </section>

      {/* Aviso de muestra */}
      {showSampleWarning && <SampleWarning />}

      {/* Listado filtrable */}
      <section className="listado" aria-label="Listado de PCs">
        <h2>Lista de PCs</h2>

        {/* Filtros */}
        <div className="filtros">
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            on e={(e) => setSearch(e.target.value)} />
          <input
            type="number"
            min="0"
            placeholder="Precio mínimo"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value ? parseFloat(e.target.value) : 0)} />
          <input
            type="number"
            min="0"
            placeholder="Precio máximo"
            value={maxPrice}
            onChange={(e) =>
              setMaxPrice(
                e.target.value ? parseFloat(e.target.value) : Infinity,
              ),
            } />
          <select
            value={onlyDiscount}
            onChange={(e) =>
              setOnlyDiscount(e.target.checked || e.target.value === 'true'),
            }>
            <option value="false">Mostrar todos</option>
            <option value="true">Solo con descuento</option>
          </select>
          <select value={cpuFilter} onChange={(e) => setCpuFilter(e.target.value)}>
            <option value="">Todo CPU</option>
            <option value="Intel">Intel</option>
            <option value="AMD">AMD</option>
          </select>
          <select value={ramFilter} onChange={(e) => setRamFilter(e.target.value)}>
            <option value="">Todo RAM</option>
            <option value="16GB">16GB</option>
            <option value="32GB">32GB</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="name">Nombre (A-Z)</option>
            <option value="price">Precio (menor/mayor)</option>
            <option value="discount">Descuento (mayor/menor)</option>
          </select>
        </div>

        {/* Lista de productos */}
        <div className="lista">
          {sorted.length === 0
            ? <p>No hay productos con los filtros aplicados.</p>
            : sorted.map((p) => (
                <PriceCard key={p.sku} p={p} />
              ))}
        </div>
      </section>

      {/* Ranking de mayores bajadas */}
      <section className="ranking" aria-label="Rankings">
        <h2>Mayores bajadas {%</h2>
        <p>
          {allPrices.filter(p => p.discount && p.discount > 0).length} productos tienen descuento
        </p>
        <div className="ranking-lista">
          {allPrices
            .filter(p => p.discount && p.discount > 0)
            .sort((a, b) => (b.discount || 0) - (a.discount || 0))
            .slice(0, 5)
            .map((p) => (
              <div key={p.sku} className="ranking-item">
                <span>{p.name.split(' / ')[0].substring(0, 40)}...</span>
                <span>{p.discount}%</span>
              </div>
            ))}
        </div>
      </section>
    </main>
  )
}