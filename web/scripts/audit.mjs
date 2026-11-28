#!/usr/bin/env node
/**
 * Auditoría de datos de la web.
 *
 * Imprime, sin generar nada:
 *   · filas de data/history.csv por fecha (filas, SKUs únicos, SKUs con precio)
 *   · nº de SKUs de data/products.json
 *   · nº de productos de web/public/data/prices.json
 *   · nº de PCs con precio en el último scrape
 *
 * Y explica de dónde salían las cifras antiguas "646 PCs / 644 con precio"
 * cuando el scrape del 26/11 guardó 655 filas.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..')
const REPO_ROOT = path.resolve(WEB_ROOT, '..')
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(REPO_ROOT, 'data')
const PUBLIC_DATA = path.join(WEB_ROOT, 'public', 'data')

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
        } else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\r') {
      // ignorar
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  if (!rows.length) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1)
    .filter((values) => !values.every((v) => String(v).trim() === ''))
    .map((values) => Object.fromEntries(headers.map((h, i) => [h, i < values.length ? values[i] : ''])))
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return fallback
  }
}

function pct(part, total) {
  return total ? `${((part / total) * 100).toFixed(1)} %` : '—'
}

console.log('AUDITORÍA DE DATOS · tracker/5070')
console.log('='.repeat(72))
console.log(`DATA_DIR: ${DATA_DIR}`)

const historyFile = path.join(DATA_DIR, 'history.csv')
const productsFile = path.join(DATA_DIR, 'products.json')
const rawHistory = fs.existsSync(historyFile) ? parseCSV(fs.readFileSync(historyFile, 'utf-8')) : []
const rows = rawHistory.filter((row) => row.fecha && row.sku)
const products = readJSON(productsFile, {})
const prices = readJSON(path.join(PUBLIC_DATA, 'prices.json'), [])
const meta = readJSON(path.join(PUBLIC_DATA, 'meta.json'), null)

const byDate = new Map()
for (const row of rows) {
  if (!byDate.has(row.fecha)) byDate.set(row.fecha, [])
  byDate.get(row.fecha).push(row)
}

console.log('\n1) history.csv por fecha')
console.log('fecha       filas  SKUs  con precio  primera hora  última hora')
for (const date of [...byDate.keys()].sort()) {
  const dateRows = byDate.get(date)
  const skus = new Set(dateRows.map((row) => String(row.sku)))
  const withPrice = new Set(
    dateRows.filter((row) => String(row.precio || '').trim() !== '').map((row) => String(row.sku))
  )
  const times = dateRows.map((row) => row.hora).filter(Boolean).sort()
  console.log(
    `${date}  ${String(dateRows.length).padStart(5)}  ${String(skus.size).padStart(4)}  ${String(
      withPrice.size
    ).padStart(10)}  ${String(times[0] || '—').padStart(12)}  ${String(times[times.length - 1] || '—').padStart(10)}`
  )
}

console.log('\n2) Metadatos')
console.log(`SKUs en data/products.json ................ ${Object.keys(products).length}`)
console.log(`Productos en public/data/prices.json ...... ${prices.length}`)
console.log(`  · activos (presentes en el último scrape) ${prices.filter((p) => !p.isDiscontinued).length}`)
console.log(`  · descatalogados ........................ ${prices.filter((p) => p.isDiscontinued).length}`)
console.log(`  · con precio ............................ ${prices.filter((p) => p.currentPrice !== null).length}`)

if (meta) {
  console.log(`Último scrape (meta) ...................... ${meta.lastScrape} ${meta.lastScrapeTime || ''}`)
  console.log(`N (activos del último scrape) ............. ${meta.totals.active}`)
  console.log(`Con precio en el último scrape ............ ${meta.totals.withPrice}`)
} else {
  const lastDate = [...byDate.keys()].sort().pop() || null
  const lastSkus = lastDate ? new Set(byDate.get(lastDate).map((row) => String(row.sku))) : new Set()
  const active = prices.filter((p) => p.lastSeen === lastDate)
  console.log(`Último scrape ............................ ${lastDate || 'sin datos'}`)
  console.log(`SKUs presentes en el último scrape ........ ${lastSkus.size}`)
  console.log(`N (fichas con lastSeen = último scrape) ... ${active.length}`)
  console.log(`Con precio en el último scrape ............ ${active.filter((p) => p.currentPrice !== null).length}`)
}

console.log('\n3) Por qué la web mostraba "646 PCs · 644 con precio" con el scrape del 26/11')
const targetDate = '2026-11-26'
const targetRows = byDate.get(targetDate) || []
const targetSkus = new Set(targetRows.map((row) => String(row.sku)))
const productSkus = new Set(Object.keys(products))
const metaSkus = new Set(
  [...targetSkus].filter((sku) => {
    const item = products[sku]
    return Boolean(item && item.name)
  })
)
const missingInProducts = [...targetSkus].filter((sku) => !metaSkus.has(sku))
const staleInProducts = [...productSkus].filter((sku) => !targetSkus.has(sku))
const cards = [...productSkus].length
const updated = [...metaSkus].length
const lastDate = [...byDate.keys()].sort().pop() || null
const lastSkus = lastDate ? new Set(byDate.get(lastDate).map((row) => String(row.sku))) : new Set()
const lastMissing = prices.filter((p) => p.lastSeen !== lastDate && lastSkus.has(p.sku)).length

console.log(`  Scrape del ${targetDate} guardado en history.csv ... ${targetSkus.size} SKUs`)
console.log(`  SKUs con metadatos en data/products.json .......... ${updated}`)
console.log(`  SKUs del scrape sin metadatos (se descartaban) .... ${missingInProducts.length}`)
console.log(`  SKUs de products.json ausentes ese día ............ ${staleInProducts.length}`)
console.log(`  Tarjetas antiguas (products.json) ................. ${cards}`)
console.log(`  De ellas, actualizadas en ese scrape .............. ${updated}`)
console.log(`  De ellas, con precio antiguo (23/11) .............. ${staleInProducts.length}`)
console.log('')
console.log('  Explicación: build-prices.js recorría el universo de data/products.json (646 SKUs).')
console.log('  De esos 646, solo 644 tenían fila en el scrape del 26/11; los otros 2 seguían')
console.log('  mostrando el precio del 23/11. Los 11 SKUs scrapeados que aún no estaban en')
console.log('  products.json se descartaban en silencio (655 − 11 = 644). Las dos cifras eran,')
console.log('  por tanto, 646 fichas construidas y 644 realmente actualizadas.')
console.log('')
console.log('  Corrección: build-prices.js completa metadatos con debug/last_scrape.json,')
console.log(`  de modo que la cifra N sale del último scrape real (${meta ? meta.totals.active : '—'} activos).`)
console.log(`  Los SKUs del scrape sin metadatos en ningún sitio se documentan como pérdida real.`)
console.log(`  En el 26/11 eran ${missingInProducts.length}; en el último scrape, ${lastMissing}.`)
if (missingInProducts.length) {
  console.log(`  Sin nombre el 26/11: ${missingInProducts.join(', ')}`)
}
