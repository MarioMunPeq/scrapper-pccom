#!/usr/bin/env node
/**
 * Build script para web/ - Genera web/public/data/prices.json, history.json y meta.json
 * Lee data/history.csv y data/products.json desde la raíz del repositorio
 * (o desde la carpeta indicada por la variable de entorno DATA_DIR).
 *
 * Los metadatos que falten en products.json se completan con debug/last_scrape.json
 * (volcado íntegro del último scrape). Así ningún SKU observado en el último scrape
 * se pierde por no estar todavía en products.json.
 *
 * OUT_DIR permite escribir los JSON en otra carpeta (usado por los datasets
 * temporales de verificación). NUNCA inventa productos: solo usa datos reales.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(REPO_ROOT, 'data')
const OUT_DATA_DIR = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(SCRIPT_DIR, '..', 'public', 'data')

const HISTORY_FILE = path.join(DATA_DIR, 'history.csv')
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json')
const PRODUCTS_FALLBACK = path.join(REPO_ROOT, 'data', 'products.json')
const LAST_SCRAPE_FILE = path.join(REPO_ROOT, 'debug', 'last_scrape.json')

const PRICES_OUTPUT = path.join(OUT_DATA_DIR, 'prices.json')
const HISTORY_OUTPUT = path.join(OUT_DATA_DIR, 'history.json')
const META_OUTPUT = path.join(OUT_DATA_DIR, 'meta.json')

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTHS_LONG = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]
const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

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
// Atributos
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

    if (gb <= 24 && /5070\s*$/i.test(prefix)) continue
    if (gb <= 24 && /\bTi\s*$/i.test(prefix)) continue
    if (/^\s*(?:GDDR|SSD|NVMe|HDD|M\.2|SATA)/i.test(suffix)) continue

    const candidate = `${gb}GB`
    if (/^\s*(?:RAM|DDR)/i.test(suffix)) return candidate
    if (!fallback) fallback = candidate
  }
  return fallback
}

function extractSsd(name) {
  let m = name.match(/(\d+)\s*(GB|TB)\s*(SSD|NVMe|M\.2)\b/i)
  if (m) return formatStorage(m[1], m[2], m[3])
  m = name.match(/\b(SSD|NVMe|M\.2)\s*(\d+)\s*(GB|TB)\b/i)
  if (m) return formatStorage(m[2], m[3], m[1])
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

/** Familias usadas por los filtros del catálogo. */
function cpuFamilyOf(name, cpu) {
  const haystack = `${cpu || ''} ${name || ''}`
  if (/\bRyzen\s+9\b/i.test(haystack)) return 'Ryzen 9'
  if (/\bRyzen\s+7\b/i.test(haystack)) return 'Ryzen 7'
  if (/\bRyzen\s+5\b/i.test(haystack)) return 'Ryzen 5'
  if (/\bCore\s+Ultra\s+9\b|\bUltra\s+9\b/i.test(haystack)) return 'Core Ultra 9'
  if (/\bCore\s+Ultra\s+7\b|\bUltra\s+7\b/i.test(haystack)) return 'Core Ultra 7'
  if (/\bCore\s+Ultra\s+5\b|\bUltra\s+5\b/i.test(haystack)) return 'Core Ultra 5'
  if (/\b(?:Core\s+)?i9\b/i.test(haystack)) return 'Core i9'
  if (/\b(?:Core\s+)?i7\b/i.test(haystack)) return 'Core i7'
  if (/\b(?:Core\s+)?i5\b/i.test(haystack)) return 'Core i5'
  if (/\b(?:Core\s+)?i3\b/i.test(haystack)) return 'Core i3'
  return 'Otros'
}

const NAME_PREFIXES = [
  /^PC\s+Sobremesa\s+/i,
  /^PC\s+de\s+Sobremesa\s+/i,
  /^Ordenador\s+Sobremesa\s+/i,
  /^Sobremesa\s+/i,
]

function shortNameOf(name) {
  let out = clean(name)
  let changed = true
  while (changed) {
    changed = false
    for (const re of NAME_PREFIXES) {
      if (re.test(out)) {
        out = clean(out.replace(re, ''))
        changed = true
      }
    }
  }
  return out || clean(name)
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------
function dayNumber(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return NaN
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/**
 * "Entrega a partir del domingo, 29 de noviembre"
 * "Entrega el martes, 1 de diciembre"
 *   → "Entrega dom 29 nov" / "Entrega mar 1 dic"
 */
function availabilityShortOf(value) {
  const text = clean(value || '')
  if (!text) return ''
  const match = text.match(
    /entrega(?:\s+a\s+partir\s+de(?:l)?)?(?:\s+el)?\s+(?:\p{L}+,\s*)?(\d{1,2})\s+de\s+(\p{L}+)/iu
  )
  if (!match) return text
  const day = Number(match[1])
  const monthName = match[2].toLowerCase()
  const month = MONTHS_LONG.findIndex((name) => monthName.startsWith(name.slice(0, 3)))
  const year = new Date().getFullYear()
  const monthIndex = month >= 0 ? month : null
  let weekday = ''
  if (monthIndex !== null) {
    const date = new Date(Date.UTC(year, monthIndex, day))
    weekday = WEEKDAYS_SHORT[date.getUTCDay()]
  }
  const monthShort = monthIndex !== null ? MONTHS_SHORT[monthIndex] : monthName.slice(0, 3)
  return `Entrega ${weekday ? `${weekday} ` : ''}${day} ${monthShort}`.trim()
}

// ---------------------------------------------------------------------------
// Precios
// ---------------------------------------------------------------------------
function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null
  let text = String(value).replace(/\u00a0/g, ' ').trim()

  if (text.includes('€')) text = text.replace('€', '').trim()

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

function round(value, decimals = 2) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

// ---------------------------------------------------------------------------
// Lectura de datos
// ---------------------------------------------------------------------------
console.log(`DATA_DIR: ${DATA_DIR}`)
console.log(`OUT_DIR:  ${OUT_DATA_DIR}`)

if (!fs.existsSync(DATA_DIR)) {
  console.log('data/ directory does not exist. Generating empty state.')
  fs.mkdirSync(OUT_DATA_DIR, { recursive: true })
  fs.writeFileSync(PRICES_OUTPUT, JSON.stringify([], null, 2))
  fs.writeFileSync(HISTORY_OUTPUT, JSON.stringify({}))
  fs.writeFileSync(
    META_OUTPUT,
    JSON.stringify({ generatedAt: new Date().toISOString(), lastScrape: null, scrapes: [] }, null, 2)
  )
  console.log('Generated prices.json and history.json with 0 products (empty state)')
  process.exit(0)
}

let historyRows = []
const metadata = {}

try {
  const historyContent = fs.readFileSync(HISTORY_FILE, 'utf-8')
  historyRows = parseCSV(historyContent).filter((r) => r.fecha && r.sku)
  console.log(`Read ${historyRows.length} rows from history.csv`)
} catch (error) {
  console.warn('No se pudo leer history.csv', error.message)
  historyRows = []
}

function addMetadata(map, sku, name, url) {
  if (!sku || !name) return
  const key = String(sku)
  if (map[key]) return
  map[key] = { name: clean(name), url: String(url || '') }
}

try {
  let productsFile = PRODUCTS_FILE
  if (!fs.existsSync(productsFile) && productsFile !== PRODUCTS_FALLBACK && fs.existsSync(PRODUCTS_FALLBACK)) {
    productsFile = PRODUCTS_FALLBACK
    console.log('products.json no está en DATA_DIR; usando data/products.json del repositorio')
  }
  const productsContent = fs.readFileSync(productsFile, 'utf-8')
  const products = JSON.parse(productsContent)
  for (const [sku, item] of Object.entries(products)) {
    if (item && item.name) addMetadata(metadata, sku, item.name, item.url)
  }
  console.log(`Read ${Object.keys(products).length} products from ${productsFile}`)
} catch (error) {
  console.warn('No se pudo leer products.json', error.message)
}

// El volcado del último scrape completa SKUs que aún no están en products.json.
// Solo se usa si su fecha existe en history.csv (nunca contamina datasets de prueba).
let lastScrapeDump = null
try {
  if (fs.existsSync(LAST_SCRAPE_FILE)) {
    lastScrapeDump = JSON.parse(fs.readFileSync(LAST_SCRAPE_FILE, 'utf-8'))
    const dumpDate = String(lastScrapeDump.fecha || '').slice(0, 10)
    const historyDates = new Set(historyRows.map((row) => row.fecha))
    if (dumpDate && historyDates.has(dumpDate)) {
      let added = 0
      for (const item of [...(lastScrapeDump.products || []), ...(lastScrapeDump.ti_products || [])]) {
        if (item && item.sku && item.name && !metadata[String(item.sku)]) {
          addMetadata(metadata, item.sku, item.name, item.url)
          added += 1
        }
      }
      console.log(`Metadata completada desde debug/last_scrape.json: +${added} SKUs`)
    } else {
      console.log('debug/last_scrape.json no coincide con history.csv; se ignora')
    }
  }
} catch (error) {
  console.warn('No se pudo leer debug/last_scrape.json', error.message)
}

// Universo: SKUs del histórico con metadatos disponibles.
const skuSetFromHistory = [...new Set(historyRows.map((r) => String(r.sku)))]
const historySkus = skuSetFromHistory.filter((sku) => metadata[sku])
const missingMetadata = skuSetFromHistory.filter((sku) => !metadata[sku])
if (missingMetadata.length) {
  console.warn(`SKUs sin metadatos (se omiten): ${missingMetadata.length}`)
  for (const sku of missingMetadata) console.warn(`  - ${sku}`)
}

const allDates = [...new Set(historyRows.map((row) => row.fecha))].sort()
const latestDate = allDates.length ? allDates[allDates.length - 1] : null

function latestTimeFor(rows) {
  let time = ''
  for (const row of rows) {
    if (row.fecha !== latestDate) continue
    if (row.hora && row.hora > time) time = row.hora
  }
  return time
}

// ---------------------------------------------------------------------------
// Construcción
// ---------------------------------------------------------------------------
const pricesData = []
const historyMap = {}
const scrapeStats = new Map(
  allDates.map((date) => [date, { date, time: '', skus: new Set(), withPrice: new Set(), prices: [] }])
)

for (const sku of historySkus) {
  const meta = metadata[sku]
  const name = meta.name
  const url = meta.url || ''

  const skuRows = historyRows
    .filter((row) => String(row.sku) === sku && parsePrice(row.precio) !== null)
    .sort((a, b) => {
      const da = `${a.fecha} ${a.hora || ''}`
      const db = `${b.fecha} ${b.hora || ''}`
      return da < db ? -1 : da > db ? 1 : 0
    })

  // Una fila por fecha: el último registro del día.
  const byDate = new Map()
  for (const row of skuRows) byDate.set(row.fecha, row)
  const dailyRows = [...byDate.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))

  const series = dailyRows.map((row) => [row.fecha, parsePrice(row.precio)])
  if (series.length > 0) historyMap[sku] = series

  const lastRow = dailyRows.length > 0 ? dailyRows[dailyRows.length - 1] : null
  const currentPrice = lastRow ? parsePrice(lastRow.precio) : null
  const lastSeen = lastRow ? lastRow.fecha : null
  const firstSeen = dailyRows.length > 0 ? dailyRows[0].fecha : null

  let pvpr = lastRow ? parsePrice(lastRow.precio_anterior) : null
  if (pvpr !== null && (currentPrice === null || pvpr <= currentPrice)) pvpr = null
  const discountPvpr =
    pvpr !== null && currentPrice !== null && pvpr > currentPrice
      ? round(((pvpr - currentPrice) / pvpr) * 100, 1)
      : null

  // Scrape actual vs scrape anterior DEL PRODUCTO (no necesariamente el día anterior).
  const prevRow = dailyRows.length >= 2 ? dailyRows[dailyRows.length - 2] : null
  const prevPrice = prevRow ? parsePrice(prevRow.precio) : null
  const prevDate = prevRow ? prevRow.fecha : null
  const deltaAbs = prevPrice !== null && currentPrice !== null ? round(currentPrice - prevPrice) : null
  const deltaPct =
    prevPrice !== null && currentPrice !== null && prevPrice > 0
      ? round(((currentPrice - prevPrice) / prevPrice) * 100, 2)
      : null

  const priceSeries = dailyRows.map((row) => parsePrice(row.precio))
  const minPriceHistorico = priceSeries.length > 0 ? Math.min(...priceSeries) : null
  const maxPriceHistorico = priceSeries.length > 0 ? Math.max(...priceSeries) : null
  const availability = lastRow && lastRow.disponibilidad ? lastRow.disponibilidad : ''
  const attributes = extractAttributes(name)
  const isDiscontinued = Boolean(lastSeen && latestDate && lastSeen < latestDate)
  const isNew = Boolean(firstSeen && latestDate && firstSeen === latestDate && allDates.length >= 2)
  const lastUpdated = lastRow ? `${lastRow.fecha}${lastRow.hora ? ` ${lastRow.hora}` : ''}` : null

  pricesData.push({
    sku,
    name,
    shortName: shortNameOf(name),
    url,
    currentPrice,
    pvpr,
    discountPvpr,
    prevPrice,
    prevDate,
    deltaAbs,
    deltaPct,
    previousPrice: prevPrice,
    recentChangePct: deltaPct,
    recentDropPct: deltaPct !== null && deltaPct < 0 ? -deltaPct : null,
    minPriceHistorico,
    maxPriceHistorico,
    firstPrice: priceSeries.length > 0 ? priceSeries[0] : null,
    lastPrice: priceSeries.length > 0 ? priceSeries[priceSeries.length - 1] : null,
    totalRegistros: skuRows.length,
    numDiasHistorial: dailyRows.length,
    availability,
    availabilityShort: availabilityShortOf(availability),
    attributes,
    cpuFamily: cpuFamilyOf(name, attributes.cpu),
    firstSeen,
    lastSeen,
    isNew,
    isDiscontinued,
    lastUpdated,
    hito: null,
    esMuestra: false,
    motivoMuestra: '',
    datosReales: true,
    showHistoryNote: dailyRows.length < 2,
    sparkline: priceSeries.slice(-30),
  })
}

pricesData.sort((a, b) => a.name.localeCompare(b.name, 'es'))

fs.mkdirSync(OUT_DATA_DIR, { recursive: true })
fs.writeFileSync(PRICES_OUTPUT, JSON.stringify(pricesData, null, 2))
fs.writeFileSync(HISTORY_OUTPUT, JSON.stringify(historyMap))

// Estadísticas por scrape sobre TODO history.csv (incluidos SKUs sin metadatos),
// para que N y la serie de mediana reflejen lo que realmente se scrapeó.
const dailyBySku = new Map()
for (const row of historyRows) {
  if (parsePrice(row.precio) === null) continue
  const sku = String(row.sku)
  if (!dailyBySku.has(sku)) dailyBySku.set(sku, new Map())
  const byDate = dailyBySku.get(sku)
  const previous = byDate.get(row.fecha)
  if (!previous || (row.hora || '') >= (previous.hora || '')) byDate.set(row.fecha, row)
}

const dropsByDate = new Map()
for (const [sku, byDate] of dailyBySku) {
  const daily = [...byDate.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
  for (let index = 0; index < daily.length; index++) {
    const row = daily[index]
    const bucket = scrapeStats.get(row.fecha)
    if (bucket) {
      bucket.skus.add(sku)
      bucket.withPrice.add(sku)
      bucket.prices.push(parsePrice(row.precio))
      if (row.hora && row.hora > bucket.time) bucket.time = row.hora
    }
    if (index > 0 && parsePrice(row.precio) < parsePrice(daily[index - 1].precio)) {
      dropsByDate.set(row.fecha, (dropsByDate.get(row.fecha) || 0) + 1)
    }
  }
}

const scrapes = allDates.map((date) => {
  const bucket = scrapeStats.get(date)
  return {
    date,
    time: bucket ? bucket.time : '',
    skus: bucket ? bucket.skus.size : 0,
    withPrice: bucket ? bucket.withPrice.size : 0,
    median: bucket && bucket.prices.length ? median(bucket.prices) : null,
    drops: dropsByDate.get(date) || 0,
  }
})

const active = pricesData.filter((product) => !product.isDiscontinued)
const meta = {
  generatedAt: new Date().toISOString(),
  lastScrape: latestDate,
  lastScrapeTime: latestTimeFor(historyRows),
  scrapes,
  totals: {
    entries: pricesData.length,
    active: active.length,
    discontinued: pricesData.length - active.length,
    withPrice: active.filter((product) => product.currentPrice !== null).length,
    withPvpr: pricesData.filter((product) => product.pvpr !== null).length,
  },
}
fs.writeFileSync(META_OUTPUT, JSON.stringify(meta, null, 2))

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2)
}

console.log(`Generated prices.json con ${pricesData.length} productos (${active.length} activos, ${pricesData.length - active.length} descatalogados)`)
console.log(`Generated history.json con ${Object.keys(historyMap).length} SKUs`)
console.log(`Último scrape: ${latestDate || 'sin datos'} · N activo: ${active.length}`)

// ---------------------------------------------------------------------------
// Estadísticas de extracción de atributos
// ---------------------------------------------------------------------------
const fields = ['cpu', 'ram', 'ssd', 'marca']
const counts = { cpu: 0, ram: 0, ssd: 0, marca: 0 }
const failures = []

for (const product of pricesData) {
  let missing = false
  for (const field of fields) {
    if (product.attributes[field]) counts[field] += 1
    else missing = true
  }
  if (missing) failures.push(product.name)
}

function pct(n) {
  return pricesData.length > 0 ? ((n / pricesData.length) * 100).toFixed(1) : '0.0'
}

console.log(`\nAtributos detectados (${pricesData.length} productos):`)
console.log(`  CPU:   ${counts.cpu} (${pct(counts.cpu)}%)`)
console.log(`  RAM:   ${counts.ram} (${pct(counts.ram)}%)`)
console.log(`  SSD:   ${counts.ssd} (${pct(counts.ssd)}%)`)
console.log(`  Marca: ${counts.marca} (${pct(counts.marca)}%)`)

if (failures.length > 0) {
  console.log(`\nNombres con algún atributo sin detectar (${failures.length}):`)
  failures.forEach((name) => console.log(`  - ${name}`))
} else {
  console.log('\nTodos los productos tienen CPU, RAM, SSD y marca detectados.')
}
