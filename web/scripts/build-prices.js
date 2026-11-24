#!/usr/bin/env node
/**
 * Build script para web/ - Genera web/public/data/prices.json y history.json
 * Lee data/history.csv y data/products.json desde la raíz del repositorio
 * (o desde la carpeta indicada por la variable de entorno DATA_DIR).
 * NUNCA inventa productos - solo usa datos reales.
 */

const fs = require('fs')
const path = require('path')

// Rutas del repositorio (usando rutas relativas al script)
const SCRIPT_DIR = path.resolve(__dirname)
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(REPO_ROOT, 'data')
const PUBLIC_DIR = path.resolve(SCRIPT_DIR, '..', 'public')
const PUBLIC_DATA_DIR = path.join(PUBLIC_DIR, 'data')

const HISTORY_FILE = path.join(DATA_DIR, 'history.csv')
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json')
// Fallback para pruebas con DATA_DIR: si la carpeta de datos alternativa no
// trae products.json, se usan los metadatos reales del repositorio.
const PRODUCTS_FALLBACK = path.join(REPO_ROOT, 'data', 'products.json')
const PRICES_OUTPUT = path.join(PUBLIC_DATA_DIR, 'prices.json')
const HISTORY_OUTPUT = path.join(PUBLIC_DATA_DIR, 'history.json')

// Fechas fijas para los marcadores
const BLACK_FRIDAY = new Date('2026-11-27')
const CYBER_MONDAY = new Date('2026-11-30')
const CHRISTMAS = new Date('2026-12-25')
const REYES = new Date('2027-01-06')
const JANUARY_SALES_START = new Date('2027-01-07')

// ---------------------------------------------------------------------------
// CSV parser con soporte de campos entrecomillados (comas y saltos de línea)
// ---------------------------------------------------------------------------
function parseCSV(content) {
  const text = content.replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\r') {
      // ignorar CR; el salto lo marca \n
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Convertir a objetos usando la primera fila como cabecera
  if (rows.length === 0) return []
  const headers = rows[0].map((h) => h.trim())
  const out = []
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i]
    if (values.every((v) => String(v).trim() === '')) continue
    const obj = {}
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = j < values.length ? values[j] : ''
    }
    out.push(obj)
  }
  return out
}

// ---------------------------------------------------------------------------
// Extracción de atributos
// ---------------------------------------------------------------------------
function clean(value) {
  return String(value).replace(/\s+/g, ' ').trim()
}

const CPU_RULES = [
  { re: /\bIntel\s+Ultra\s+Core\s+[3579](?:[-\s]\d{3,4}[A-Z]{0,2})?\b/i, prefix: '' },
  { re: /\bIntel\s+Ultra\s+[3579](?:[-\s]\d{3,4}[A-Z]{0,2})?\b/i, prefix: '' },
  { re: /\bIntel\s+Core\s+Ultra\s+[3579](?:[-\s]\d{3,4}[A-Z]{0,2})?\b/i, prefix: '' },
  { re: /\bCore\s+Ultra\s+[3579](?:[-\s]\d{3,4}[A-Z]{0,2})?\b/i, prefix: 'Intel ' },
  { re: /\bIntel\s+Core\s+i[3579](?:[-\s]?\d{4,5}[A-Z]{0,2})?\b/i, prefix: '' },
  { re: /\bIntel\s+i[3579](?:[-\s]?\d{4,5}[A-Z]{0,2})?\b/i, prefix: '' },
  { re: /\bCore\s+i[3579](?:[-\s]?\d{4,5}[A-Z]{0,2})?\b/i, prefix: 'Intel ' },
  { re: /\bi[3579][-\s]?\d{4,5}[A-Z]{0,2}\b/i, prefix: 'Intel Core ' },
  { re: /\bAMD\s+Ryzen\s+(?:[3579]\s+)?\d{4}[A-Z0-9]{0,4}\b/i, prefix: '' },
  { re: /\bRyzen\s+(?:[3579]\s+)?\d{4}[A-Z0-9]{0,4}\b/i, prefix: 'AMD ' },
  { re: /\bAMD\s+R[3579][-\s]?\d{4}[A-Z0-9]*\b/i, prefix: '' },
  { re: /\bAMD\s+Ryzen\s+[3579]\b/i, prefix: '' },
]

function extractCpu(name) {
  for (const rule of CPU_RULES) {
    const m = name.match(rule.re)
    if (m) return clean(rule.prefix + m[0])
  }
  return ''
}

function extractRam(name) {
  const re = /(\d+)\s*GB/gi
  let m
  let fallback = ''
  while ((m = re.exec(name))) {
    const idx = m.index
    const prefix = name.slice(Math.max(0, idx - 10), idx)
    const suffix = name.slice(idx + m[0].length, idx + m[0].length + 14)
    const gb = parseInt(m[1], 10)

    // VRAM: "RTX 5070 12GB" o "... Ti 16GB" (tamaños de VRAM habituales)
    if (gb <= 24 && /5070\s*$/i.test(prefix)) continue
    if (gb <= 24 && /\bTi\s*$/i.test(prefix)) continue
    // Almacenamiento o VRAM explícita
    if (/^\s*(?:GDDR|SSD|NVMe|HDD|M\.2|SATA)/i.test(suffix)) continue

    const candidate = `${gb}GB`
    // Preferir el que va seguido de RAM/DDR
    if (/^\s*(?:RAM|DDR)/i.test(suffix)) return candidate
    if (!fallback) fallback = candidate
  }
  return fallback
}

function extractSsd(name) {
  let m = name.match(/(\d+)\s*(GB|TB)\s*(SSD|NVMe|M\.2)\b/i)
  if (m) {
    return formatStorage(m[1], m[2], m[3])
  }
  m = name.match(/\b(SSD|NVMe|M\.2)\s*(\d+)\s*(GB|TB)\b/i)
  if (m) {
    return formatStorage(m[2], m[3], m[1])
  }
  return ''
}

function formatStorage(size, unit, type) {
  const u = unit.toUpperCase()
  let t = type.toUpperCase()
  if (t === 'NVME') t = 'NVMe'
  return `${size}${u} ${t}`
}

const BRAND_RULES = [
  [/neo\s*-?\s*pc/i, 'NeoPC'],
  [/\bpc\s*com\b/i, 'PcCom'],
  [/\bpc\s*(?:gaming\s*)?racing\b/i, 'PC Racing'],
  [/\bepical\b/i, 'Epical-Q'],
  [/\bi?buypower\b/i, 'IBUYPOWER'],
  [/\bvibox\b/i, 'Vibox'],
  [/\bvist\b/i, 'Vist'],
  [/\btecnowake\b/i, 'Tecnowake'],
  [/\bnitro\s*-?\s*pc\b/i, 'Nitropc'],
  [/\bpcm\b/i, 'PCM'],
  [/\bpcgam\b/i, 'PCGAM'],
  [/\bdeep\s*gaming\b/i, 'DeepGaming'],
  [/\bmegaman[ií]a\b/i, 'Megamania'],
  [/\bgreed\b/i, 'GREED'],
  [/\bbeastcom\b/i, 'BEASTCOM'],
  [/\bzone\s*evil\b/i, 'Zone Evil'],
  [/\bhur[aá]can\b/i, 'Huracan'],
  [/\bmsi\b/i, 'MSI'],
  [/\basus\b/i, 'ASUS'],
  [/\blenovo\b/i, 'Lenovo'],
  [/\bacer\b/i, 'Acer'],
  [/\bcooler\s*master\b/i, 'Cooler Master'],
  [/\baeon\b/i, 'Aeon'],
  [/\bcentrum\b/i, 'Centrum'],
  [/\bdaitona\b/i, 'Daitona'],
  [/\bracing\b/i, 'PC Racing'],
]

function extractBrand(name) {
  for (const [re, brand] of BRAND_RULES) {
    if (re.test(name)) return brand
  }
  return ''
}

function extractAttributes(name) {
  return {
    cpu: extractCpu(name),
    ram: extractRam(name),
    ssd: extractSsd(name),
    marca: extractBrand(name),
  }
}

// ---------------------------------------------------------------------------
// Fechas / hitos
// ---------------------------------------------------------------------------
function isHito(date) {
  const parts = String(date).slice(0, 10).split('-').map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null
  const [year, month, day] = parts

  if (year === BLACK_FRIDAY.getFullYear() && month === BLACK_FRIDAY.getMonth() + 1 && day === BLACK_FRIDAY.getDate())
    return 'Black Friday (27/11)'
  if (year === CYBER_MONDAY.getFullYear() && month === CYBER_MONDAY.getMonth() + 1 && day === CYBER_MONDAY.getDate())
    return 'Cyber Monday (30/11)'
  if (year === CHRISTMAS.getFullYear() && month === CHRISTMAS.getMonth() + 1 && day === CHRISTMAS.getDate())
    return 'Navidad (25/12)'
  if (year === REYES.getFullYear() && month === REYES.getMonth() + 1 && day === REYES.getDate())
    return 'Reyes (6/1)'
  if (year === 2027 && month === 1 && day >= JANUARY_SALES_START.getDate())
    return 'Rebajas de enero'
  return null
}

// ---------------------------------------------------------------------------
// Precios
// ---------------------------------------------------------------------------
function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null
  let text = String(value).replace(/\u00a0/g, ' ').trim()

  if (text.includes('€')) {
    text = text.replace('€', '').trim()
  }

  let processed = text

  if (processed.includes(',')) {
    processed = processed.replace(/\./g, '').replace(',', '.')
  } else if (/^\d+\.\d{2}$/.test(processed)) {
    processed = processed
  } else if (/^\d+\.\d{3}$/.test(processed)) {
    processed = processed.replace(/\./g, '')
  } else if (/^\d+\.\d+$/.test(processed) && processed.split('.')[1].length >= 3) {
    processed = processed.replace(/\./g, '').replace(',', '.')
  }

  const num = parseFloat(processed)
  return Number.isNaN(num) ? null : num
}

function round(value) {
  return Math.round(value * 100) / 100
}

// ---------------------------------------------------------------------------
// Lectura de datos
// ---------------------------------------------------------------------------
console.log(`DATA_DIR: ${DATA_DIR}`)

const dataDirExists = fs.existsSync(DATA_DIR)
if (!dataDirExists) {
  console.log('data/ directory does not exist. Generating empty state.')
  fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true })
  fs.writeFileSync(PRICES_OUTPUT, JSON.stringify([], null, 2))
  fs.writeFileSync(HISTORY_OUTPUT, JSON.stringify({}))
  console.log('Generated prices.json and history.json with 0 products (empty state)')
  process.exit(0)
}

let historyRows = []
let products = {}

try {
  const historyContent = fs.readFileSync(HISTORY_FILE, 'utf-8')
  historyRows = parseCSV(historyContent).filter((r) => r.fecha && r.sku)
  console.log(`Read ${historyRows.length} rows from history.csv`)
} catch (e) {
  console.warn('No se pudo leer history.csv', e.message)
  historyRows = []
}

try {
  let productsFile = PRODUCTS_FILE
  if (!fs.existsSync(productsFile) && productsFile !== PRODUCTS_FALLBACK) {
    productsFile = PRODUCTS_FALLBACK
    console.log('products.json no está en DATA_DIR; usando data/products.json del repositorio')
  }
  const productsContent = fs.readFileSync(productsFile, 'utf-8')
  products = JSON.parse(productsContent)
  console.log(`Read ${Object.keys(products).length} products from ${productsFile}`)
} catch (e) {
  console.warn('No se pudo leer products.json', e.message)
  products = {}
}

// SKUs reales (union de products.json y history.csv)
const skuSetFromProducts = Object.keys(products).filter(
  (sku) => products[sku] && products[sku].name
)
const skuSetFromHistory = [...new Set(historyRows.map((r) => r.sku))]
const allSkus = [...new Set([...skuSetFromProducts, ...skuSetFromHistory])]

console.log(`Total de SKU a procesar: ${allSkus.length}`)

// ---------------------------------------------------------------------------
// Construcción de prices.json e history.json
// ---------------------------------------------------------------------------
const pricesData = []
const historyMap = {}

for (const sku of allSkus) {
  const product = products[sku]
  const name = product ? product.name : null
  if (!name) continue

  const url = product && product.url ? product.url : ''

  const skuRows = historyRows
    .filter((r) => r.sku === sku && parsePrice(r.precio) !== null)
    .sort((a, b) => {
      const da = `${a.fecha} ${a.hora || ''}`
      const db = `${b.fecha} ${b.hora || ''}`
      return da < db ? -1 : da > db ? 1 : 0
    })

  // Una fila por fecha: el último registro del día. Así la variación es
  // realmente "respecto al día anterior", no respecto a otro scrape del día.
  const byDate = new Map()
  for (const row of skuRows) {
    byDate.set(row.fecha, row)
  }
  const dailyRows = [...byDate.values()]

  // Serie compacta [fecha, precio] ordenada por fecha
  const series = dailyRows.map((r) => [r.fecha, parsePrice(r.precio)])
  if (series.length > 0) {
    historyMap[sku] = series
  }

  const lastRow = dailyRows.length > 0 ? dailyRows[dailyRows.length - 1] : null
  const currentPrice = lastRow ? parsePrice(lastRow.precio) : null

  // PVPR: precio tachado de la web en la última observación
  let pvpr = lastRow ? parsePrice(lastRow.precio_anterior) : null
  if (pvpr !== null && (currentPrice === null || pvpr <= currentPrice)) {
    pvpr = null
  }
  const discountPvpr =
    pvpr !== null && currentPrice !== null && pvpr > currentPrice
      ? round(((pvpr - currentPrice) / pvpr) * 100)
      : null

  // Precio del día anterior (para bajada respecto al día anterior)
  const previousPrice =
    dailyRows.length >= 2 ? parsePrice(dailyRows[dailyRows.length - 2].precio) : null
  const recentChangePct =
    previousPrice !== null && currentPrice !== null && previousPrice > 0
      ? round(((currentPrice - previousPrice) / previousPrice) * 100)
      : null
  const recentDropPct =
    recentChangePct !== null && recentChangePct < 0 ? -recentChangePct : null

  // Serie de precios y min/max
  const priceSeries = dailyRows.map((r) => parsePrice(r.precio))
  const minPriceHistorico = priceSeries.length > 0 ? Math.min(...priceSeries) : null
  const maxPriceHistorico = priceSeries.length > 0 ? Math.max(...priceSeries) : null
  const firstPrice = priceSeries.length > 0 ? priceSeries[0] : null
  const lastPrice = priceSeries.length > 0 ? priceSeries[priceSeries.length - 1] : null

  // Días con datos (fechas únicas del producto)
  const numDiasHistorial = dailyRows.length

  const availability = lastRow && lastRow.disponibilidad ? lastRow.disponibilidad : ''
  const lastUpdated =
    lastRow && lastRow.fecha
      ? `${lastRow.fecha}${lastRow.hora ? ' ' + lastRow.hora : ''}`
      : null
  const hito = lastRow && lastRow.fecha ? isHito(lastRow.fecha) : null

  // Sparkline compacta: últimos 14 precios
  const sparkline = priceSeries.slice(-14)

  pricesData.push({
    sku,
    name,
    url,
    currentPrice,
    pvpr,
    discountPvpr,
    previousPrice,
    recentChangePct,
    recentDropPct,
    minPriceHistorico,
    maxPriceHistorico,
    firstPrice,
    lastPrice,
    totalRegistros: skuRows.length,
    numDiasHistorial,
    availability,
    attributes: extractAttributes(name),
    hito,
    esMuestra: false,
    motivoMuestra: '',
    datosReales: true,
    showHistoryNote: numDiasHistorial < 2,
    lastUpdated,
    sparkline,
  })
}

// Ordenar por nombre para un orden estable
pricesData.sort((a, b) => a.name.localeCompare(b.name, 'es'))

// Asegurar directorio
fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true })

// Escribir ficheros
fs.writeFileSync(PRICES_OUTPUT, JSON.stringify(pricesData, null, 2))
fs.writeFileSync(HISTORY_OUTPUT, JSON.stringify(historyMap))
console.log(`Generated prices.json con ${pricesData.length} productos (datos reales)`)
console.log(`Generated history.json con ${Object.keys(historyMap).length} SKUs`)

// ---------------------------------------------------------------------------
// Estadísticas de extracción de atributos
// ---------------------------------------------------------------------------
const total = pricesData.length
const fields = ['cpu', 'ram', 'ssd', 'marca']
const counts = { cpu: 0, ram: 0, ssd: 0, marca: 0 }
const failures = []

for (const p of pricesData) {
  let missing = false
  for (const f of fields) {
    if (p.attributes[f]) counts[f] += 1
    else missing = true
  }
  if (missing) failures.push(p.name)
}

function pct(n) {
  return total > 0 ? ((n / total) * 100).toFixed(1) : '0.0'
}

console.log(`\nAtributos detectados (${total} productos):`)
console.log(`  CPU:   ${counts.cpu} (${pct(counts.cpu)}%)`)
console.log(`  RAM:   ${counts.ram} (${pct(counts.ram)}%)`)
console.log(`  SSD:   ${counts.ssd} (${pct(counts.ssd)}%)`)
console.log(`  Marca: ${counts.marca} (${pct(counts.marca)}%)`)

if (failures.length > 0) {
  console.log(`\nNombres con algún atributo sin detectar (${failures.length}):`)
  failures.forEach((n) => console.log(`  - ${n}`))
} else {
  console.log('\nTodos los productos tienen CPU, RAM, SSD y marca detectados.')
}
