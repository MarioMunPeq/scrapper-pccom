#!/usr/bin/env node
/** 
 * Build script para web/ - Genera web/public/data/prices.json
 * Lee data/history.csv y data/products.json desde la raíz del repositorio.
 * Genera web/public/data/prices.json con la serie completa de precios por SKU y estadísticas.
 * NUNCA inventa productos - solo usa datos reales
 * Usa TODAS las observaciones del histórico para min/max/promedio
 * Si hay < 3 días de historial, muestra datos reales con aviso
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
  marca: /(PcCom|Vibox|PCM|Aeon|NeoPC|Gamer|Gaming|Centrum|IBUYPOWER|DeepGaming|NitroPC|Tecnowake|Epical-q)/gi,
}

/** Extrae atributos del nombre del producto */
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

/** Detecta si la fecha es un hito conocido y devuelve la etiqueta */
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

/** Parses un precio string a número (quita €, separadores de miles) */
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

  // Filtrar rows de histórico para este SKU (todos los registros reales), ordenados por fecha
  const skuRows = historyRows.filter(r => r.sku === sku).sort(function (a, b) {
    return new Date(a.fecha) - new Date(b.fecha)
  })

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
      priceSeries: [], //serie temporal para el chart
      firstPrice: null,
      lastPrice: null,
    })
    continue
  }

  // Extraer precio actual: la observación más reciente (última fila al ordenar por fecha ascending)
  // skuRows ya están ordenados ascending por fecha, así que la última es la más reciente
  const currentPrice = parsePrice(skuRows[skuRows.length - 1].precio)

  // Usar la observación anterior a la última para previousPrice y discount
  // Si hay al menos 2 observaciones, el previousPrice es la penúltima
  let previousPrice = null
  let discount = null
  let priceSeries = []
  
  if (skuRows.length >= 2) {
    previousPrice = parsePrice(skuRows[skuRows.length - 2].precio)
    // Descuento respecto a la observación anterior (precio real histórico)
    if (previousPrice !== null && currentPrice !== null && previousPrice > currentPrice) {
      discount = round((previousPrice - currentPrice) / previousPrice * 100)
    }
  } else if (skuRows.length === 1) {
    // Solo una observación: previousPrice es null, discount es null
    // Pero podemos usar precio_anterior de la propia fila si existe
    const singleRow = skuRows[0]
    const prevFromRow = parsePrice(singleRow.precio_anterior)
    if (prevFromRow !== null && currentPrice !== null && prevFromRow > currentPrice) {
      discount = round((prevFromRow - currentPrice) / prevFromRow * 100)
    }
  }

  // priceSeries: todas las observaciones de precio a lo largo del tiempo
  // Ordenadas de más antigua a más reciente para el chart
  priceSeries = skuRows.map(r => ({
    fecha: r.fecha,
    precio: parsePrice(r.precio) || null,
    precio_anterior: parsePrice(r.precio_anterior) || null,
    descuento: parseInt(r.descuento, 10) || null,
  })).filter(s => s.precio !== null)

  // firstPrice y lastPrice de la serie real
  const firstPrice = priceSeries.length > 0 ? priceSeries[0].precio : null
  const lastPrice = priceSeries.length > 0 ? priceSeries[priceSeries.length - 1].precio : null

  // Descount final: usar previousPrice calculado arriba
  // Si no se pudo calcular, intentar de la última fila completa
  if (discount === null && priceSeries.length > 0) {
    // Usar la penúltima observación como referencia de "antes"
    if (priceSeries.length >= 2) {
      const prevP = priceSeries[priceSeries.length - 2].precio
      if (prevP !== null && currentPrice !== null && prevP > currentPrice) {
        discount = round((prevP - currentPrice) / prevP * 100)
      }
    }
  }

  // Min/max histórico sobre TODAS las observaciones
  const pricesValues = priceSeries.map(s => s.precio).filter(p => p !== null)
  const minPriceHistorico = pricesValues.length > 0 ? Math.min(...pricesValues) : null
  const maxPriceHistorico = pricesValues.length > 0 ? Math.max(...pricesValues) : null

  // Calcular variation7d basándonos en datos reales
  // Buscar precios de los últimos 7 días disponibles
  const variation7d = calculateVariation7d(skuRows, priceSeries)
  
  // Total de registros (días con datos)
  const totalRegistros = skuRows.length

  // Detectar el hito más reciente
  const hitoMasRecente = skuRows.filter(r => r.fecha).sort(function (a, b) {
    return new Date(a.fecha) - new Date(b.fecha)
  }).reverse()[0]
  const hitoInfo = hitoMasRecente ? isHito(hitoMasRecente.fecha) : null

  // Determinar si mostrar nota de historial en construcción
  const showHistoryNote = numDiasHistorial < 3

  pricesData.push({
    sku,
    name,
    currentPrice,
    previousPrice,
    discount,      // Descuento real basado en observaciones históricas
    minPriceHistorico,
    maxPriceHistorico,
    variation7d,
    totalRegistros,
    attributes: extractAttributes(name),
    hito: hitoInfo,
    esMuestra: false,
    motivoMuestra: '',
    datosReales: true,
    showHistoryNote,
    numDiasHistorial,
    priceSeries, // Serie temporal completa para el chart
    firstPrice,
    lastPrice,
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

/** Calcula la variación porcentual en 7 días basándose en datos reales */
function calculateVariation7d(skuRows, priceSeries) {
  if (priceSeries.length < 2) return 0
  
  // Obtener la última precio de la serie
  const lastPrice = priceSeries[priceSeries.length - 1].precio
  if (lastPrice === null) return 0
  
  // Buscar el precio hace 7 días
  // Las filas de history.csv tienen fechas, buscamos la fecha hace aproximadamente 7 días
  const today = new Date()
  const sevenDaysAgo = new Date(today)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0]
  
  // Encontrar la observación más cercana a hace 7 días
  let price7DaysAgo = null
  for (const row of skuRows.reverse()) {
    const rowDate = new Date(row.fecha)
    if (rowDate <= sevenDaysAgo) {
      price7DaysAgo = parsePrice(row.precio)
      break
    }
  }
  
  if (price7DaysAgo === null || lastPrice === null || price7DaysAgo === lastPrice) return 0
  
  return round((lastPrice - price7DaysAgo) / price7DaysAgo * 100)
}

function round(value) {
  return Math.round(value * 100) / 100
}