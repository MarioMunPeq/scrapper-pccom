#!/usr/bin/env node
/** 
 * Build script para web/ - Genera web/public/data/prices.json
 * LEYE SIEMPRE data/history.csv y data/products.json
 * NUNCA inventa productos - solo usa datos reales
 * Usa precio_anterior de history.csv como previousPrice (PVPR real)
 * Usa descuento de history.csv como discount real
 * Si hay < 3 días de historial, muestra puntos reales con aviso
 * Si data/ vacío o inexistente, muestra estado vacío
 */ 

const fs = require('fs')
const path = require('path')

// Rutas del repositorio (usando rutas relativas al script)
const SCRIPT_DIR = path.resolve(__dirname)
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const DATA_DIR = path.join(REPO_ROOT, 'data')
const PUBLIC_DIR = path.resolve(SCRIPT_DIR, '..', 'public')
const PUBLIC_DATA_DIR = path.join(PUBLIC_DIR, 'data')

const HISTORY_FILE = path.join(DATA_DIR, 'history.csv')
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json')
const PRICES_OUTPUT = path.join(PUBLIC_DATA_DIR, 'prices.json')

// Fechas fijas para los marcadores
const BLACK_FRIDAY = new Date('2026-11-27')
const CYBER_MONDAY = new Date('2026-11-30')
const CHRISTMAS = new Date('2026-12-25')
const REYES = new Date('2027-01-06')
const JANUARY_SALES_START = new Date('2027-01-05')

// Regex para extraer atributos del nombre del producto
const ATTR_REGEX = {
  cpu: /(Intel|AMD|Core|Ryzen)\s+\w+(?:\s+\w+)?/gi,
  ram: /(\d+)\s*GB\s*RAM/gi,
  ssd: /(\d+)\s*TB\s*SSD|(\d+)\s*GB\s*SSD/gi,
  marca: /(PcCom|Vibox|PCM|Aeon|NeoPC|Gamer|Gaming|Centrum)/gi,
}

/** 
 * Extrae atributos del nombre del producto usando regex 
 */ 
function extractAttributes(name) {
  const result = { cpu: '', ram: '', ssd: '', marca: '' }
  const matches = name.match(ATTR_REGEX)
  if (matches) {
    for (const m of matches) {
      const upper = m.toUpperCase()
      if (/PCCOM|VIBOX|PCM|AEON|NEOPC|GAMER|GAMING|CENTRUM/i.test(m)) result.marca = m
      if (/INTEL|AMD|CORE|RYZEN/i.test(m)) result.cpu = m
      if (/\d+\s*GB\s*RAM/i.test(m)) result.ram = m
      if (/\d+\s*TB\s*SSD|\d+\s*GB\s*SSD/i.test(m)) result.ssd = m
    }
  }
  return result
}

/** 
 * Parses un precio string a número (quita €, separadores de miles) 
 */ 
function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null
  const text = String(value)

  if (text.includes('€')) {
    text = text.replace('€', '').trim()
  }

  let processed = text

  if (processed.includes(',')) {
    // Formato español: "1.799,00" -> 1799.00
    processed = processed.replace(/\./g, '').replace(',', '.')
  } else if (processed.match(/^\d+\.\d{2}$/)) {
    // Formato internacional exacto "2489.00"
    processed = processed
  } else if (processed.match(/^\d+\.\d{3}$/)) {
    // Formato "1.799" (punto miles, sin decimales) -> 1799
    processed = processed.replace(/\./g, '')
  } else if (processed.match(/^\d+\.\d+$/) && processed.split('.')[1].length >= 3) {
    // Punto decimal con 3+ dígitos: tratar como español
    processed = processed.replace(/\./g, '').replace(',', '.')
  }

  const num = parseFloat(processed)
  return isNaN(num) ? null : num
}

/* --- CSV Parser simple (sin dependencias externas) --- */
function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim().length > 0)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim())
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim())
    const row = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = j < values.length ? values[j] : ''
    }
    rows.push(row)
  }
  return rows
}

/** 
 * Detecta si la fecha es un hito conocido y devuelve la etiqueta 
 */ 
function isHito(date) {
  const d = new Date(date)
  if (d.getDate() === BLACK_FRIDAY.getDate() && d.getMonth() === BLACK_FRIDAY.getMonth())
    return 'Black Friday (27/11)'
  if (d.getDate() === CYBER_MONDAY.getDate() && d.getMonth() === CYBER_MONDAY.getMonth())
    return 'Cyber Monday (30/11)'
  if (d.getDate() === CHRISTMAS.getDate() && d.getMonth() === CHRISTMAS.getMonth())
    return 'Navidad (25/12)'
  if (d.getDate() === REYES.getDate() && d.getMonth() === REYES.getMonth())
    return 'Reyes (6/1)'
  if (d >= JANUARY_SALES_START) return 'Rebajas enero'
  return null
}

/* --- Lógica principal --- */

let historyRows = []
let products = {}

// Verificar si data/ existe
const dataDirExists = fs.existsSync(DATA_DIR)

// Si data/ no existe, generar estado vacío
if (!dataDirExists) {
  console.log('data/ directory does not exist. Generating empty state.')
  const emptyPrices = []
  fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true })
  fs.writeFileSync(PRICES_OUTPUT, JSON.stringify(emptyPrices, null, 2))
  console.log('Generated prices.json with 0 products (empty state)')
  process.exit(0)
}

// Leer history.csv
try {
  const historyContent = fs.readFileSync(HISTORY_FILE, 'utf-8')
  historyRows = parseCSV(historyContent).filter(r => r.fecha && r.sku)
  console.log(`Read ${historyRows.length} rows from history.csv`)
} catch (e) {
  console.warn('No se pudo leer history.csv', e.message)
  historyRows = []
}

// Leer products.json
try {
  const productsContent = fs.readFileSync(PRODUCTS_FILE, 'utf-8')
  products = JSON.parse(productsContent)
  console.log(`Read ${Object.keys(products).length} products from products.json`)
} catch (e) {
  console.warn('No se pudo leer products.json', e.message)
  products = {}
}

// Determinar fechas únicas en el historial
const allFechas = [...new Set(historyRows.map(r => r.fecha))].sort()
const numDiasHistorial = allFechas.length

// Obtener lista de SKU reales (union de products.json y history.csv)
const skuSetFromProducts = Object.keys(products).filter(sku => products[sku] && products[sku].name)
const skuSetFromHistory = [...new Set(historyRows.map(r => r.sku))]
const allSkus = [...new Set([...skuSetFromProducts, ...skuSetFromHistory])]

console.log(`Total de SKU a procesar: ${allSkus.length}`)

// Construir precios para TODOS los productos reales
const pricesData = []

for (const sku of allSkus) {
  const product = products[sku]
  const name = product ? product.name : null

  if (!name) {
    // Producto en history.csv pero sin nombre en products.json - saltarlo
    // Per requirements: never invent products, so skip
    continue
  }

  // Filtrar rows de histórico para este SKU (todos los registros reales)
  const skuRows = historyRows.filter(r => r.sku === sku).sort(function (a, b) { return new Date(a.fecha) - new Date(b.fecha) })

  if (skuRows.length === 0) {
    // SKU en products.json pero sin histórico - incluir con precio actual null
    pricesData.push({
      sku,
      name,
      currentPrice: null,
      previousPrice: null,
      discount: null,
      minPriceHistorico: null,
      maxPriceHistorico: null,
      variation7d: 0,
      totalRegistros: 0,
      attributes: extractAttributes(name),
      hito: null,
      esMuestra: false,
      motivoMuestra: '',
      datosReales: true,
      showHistoryNote: false,
      numDiasHistorial: 0,
    })
    continue
  }

  // Extraer precio actual de la columna 'precio'
  const currentPrice = parsePrice(skuRows[0].precio) // Usamos la primera (y única) fila

  // Usar precio_anterior de history.csv como previousPrice (PVPR real)
  const previousPrice = parsePrice(skuRows[0].precio_anterior)

  // Usar descuento de history.csv como discount real
  const discount = skuRows[0].descuento !== undefined && skuRows[0].descuento !== '' 
    ? parseInt(skuRows[0].descuento, 10) 
    : null

  // Filtrar rows de histórico para este SKU (todos los registros reales)
  const prices = skuRows.map(r => parsePrice(r.precio)).filter(p => p !== null)

  // Precios anteriores (PVPR) de la columna 'precio_anterior' - ya tenemos previousPrice arriba
  // const preciosAnteriores = skuRows.filter(r => r.precio_anterior).map(r => parsePrice(r.precio_anterior)).filter(p => p !== null)

  // Descuentos de la columna 'descuento' - ya tenemos discount arriba
  // const descuentos = skuRows.filter(r => r.descuento).map(r => {
  //   const d = parseInt(r.descuento, 10)
  //   return !isNaN(d) ? d : null
  // }).filter(d => d !== null)

  const minPriceHistorico = prices.length > 0 ? Math.min(...prices) : null
  const maxPriceHistorico = prices.length > 0 ? Math.max(...prices) : null
  // variation7d: no aplicable con 1 dato, ponemos 0
  const variation7d = 0
  const totalRegistros = skuRows.length

  // Detectar el hito más reciente
  const hitoMasRecente = skuRows.filter(r => r.fecha).sort(function (a, b) { return new Date(a.fecha) - new Date(b.fecha) }).reverse()[0]
  const hitoInfo = hitoMasRecente ? isHito(hitoMasRecente.fecha) : null

  // Determinar si mostrar nota de historial en construcción
  const showHistoryNote = numDiasHistorial < 3

  pricesData.push({
    sku,
    name,
    currentPrice,
    previousPrice, // PVPR real de history.csv
    discount,      // Descuento real de history.csv
    minPriceHistorico,
    maxPriceHistorico,
    variation7d,
    totalRegistros,
    attributes: extractAttributes(name),
    hito: hitoInfo,
    esMuestra: false,
    motivoMuestra: '',
    datosReales: true,
    showHistoryNote, // Flag para mostrar "Historial en construcción"
    numDiasHistorial, // Número real de días de historial
  })
}

// Ordenar por SKU
pricesData.sort(function (a, b) { return a.sku.localeCompare(b.sku) })

// Asegurar directorio
fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true })

// Escribir fichero
fs.writeFileSync(PRICES_OUTPUT, JSON.stringify(pricesData, null, 2))
console.log(`Generated prices.json con ${pricesData.length} productos (datos reales)`)

// Output summary
const withNote = pricesData.filter(p => p.showHistoryNote).length
console.log(` - Productos con historial < 3 días: ${withNote}`)
console.log(` - Primer SKU: ${pricesData[0]?.sku}, Último SKU: ${pricesData[pricesData.length - 1]?.sku}`)