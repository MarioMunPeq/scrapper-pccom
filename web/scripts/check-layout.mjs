import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const dist = path.join(root, 'dist')
const BASE_PATH = '/scrapper-pccom/'

const results = []
let failures = 0

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail })
  if (!ok) failures += 1
  const mark = ok ? '  ok ' : ' FAIL'
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`)
}

function section(title) {
  console.log(`\n== ${title} ==`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitForUrl(url, timeout = 60000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return true
    } catch {
      /* todavía no escucha */
    }
    await sleep(250)
  }
  return false
}

async function startPreview() {
  const port = await freePort()
  const command = `npx vite preview --port ${port} --strictPort --host 127.0.0.1`
  const proc = spawn(command, { cwd: root, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  proc.stdout.on('data', (chunk) => (log += chunk.toString()))
  proc.stderr.on('data', (chunk) => (log += chunk.toString()))
  const url = `http://127.0.0.1:${port}${BASE_PATH}`
  const ready = await waitForUrl(url)
  if (!ready) {
    proc.kill()
    throw new Error(`vite preview no arrancó en 60 s.\n${log}`)
  }
  return { proc, url, port }
}

function stopProcess(proc) {
  if (!proc || proc.exitCode !== null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    proc.kill('SIGTERM')
  }
}

/* ------------------------------------------------------------------ */
/* Servidor estático para los datasets sintéticos                     */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function serveStatic(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const raw = decodeURIComponent((req.url || '/').split('?')[0])
      const safe = path.normalize(raw).replace(/^(\.\.[/\\])+/, '')
      let file = path.join(dir, safe)
      if (!file.startsWith(dir)) {
        res.writeHead(403).end('forbidden')
        return
      }
      try {
        if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
        if (!fs.existsSync(file)) {
          res.writeHead(404).end('not found')
          return
        }
        const body = fs.readFileSync(file)
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
        res.end(body)
      } catch {
        res.writeHead(500).end('error')
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, port })
    })
  })
}

/* ------------------------------------------------------------------ */
/* Utilidades de página                                               */
/* ------------------------------------------------------------------ */

async function newPage(browser, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: viewport.width < 640,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  return { context, page, errors }
}

async function go(page, url, selector) {
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForSelector(selector, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(120)
}

async function measure(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector)
      if (!el) return null
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return null
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return null
      return {
        x: Math.round(r.x * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10,
        right: Math.round(r.right * 10) / 10,
      }
    }
    const containerEl = document.querySelector('.page .container') || document.querySelector('main .container')
    let container = null
    if (containerEl) {
      const style = getComputedStyle(containerEl)
      const box = containerEl.getBoundingClientRect()
      container = {
        width: Math.round((box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) * 10) / 10,
        outerWidth: Math.round(box.width * 10) / 10,
      }
    }
    const grid = document.querySelector('.product-grid')
    return {
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      container,
      header: rect('.site-header'),
      headerInner: rect('.site-header__inner'),
      tabBar: rect('.tab-bar'),
      grid: rect('.product-grid'),
      card: rect('[data-card="true"]'),
      filters: rect('.filters'),
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
      headerPosition: (() => {
        const el = document.querySelector('.site-header')
        return el ? getComputedStyle(el).position : null
      })(),
      staleStrip: Boolean(document.querySelector('.stale-strip')),
      fonts: {
        geist: document.fonts.check('16px "Geist Variable"'),
        geistMono: document.fonts.check('16px "Geist Mono Variable"'),
        instrument: document.fonts.check('16px "Instrument Serif"'),
        body: getComputedStyle(document.body).fontFamily,
        h1: (() => {
          const el = document.querySelector('h1')
          return el ? getComputedStyle(el).fontFamily : null
        })(),
      },
    }
  })
}

async function fontIssues(page) {
  return page.evaluate(() => {
    const issues = []
    const seen = new Set()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      const text = (node.nodeValue || '').trim()
      if (!text) continue
      const el = node.parentElement
      if (!el || seen.has(el)) continue
      seen.add(el)
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      if (Number.parseFloat(style.opacity) === 0) continue
      const box = el.getBoundingClientRect()
      if (box.width < 1 || box.height < 1) continue
      const size = Number.parseFloat(style.fontSize)
      if (!Number.isFinite(size) || size >= 11) continue
      if (el.closest('[data-micro="true"]')) continue
      issues.push({
        text: text.slice(0, 48),
        size,
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') || '').slice(0, 60),
      })
    }
    return issues
  })
}

async function overflowIssues(page) {
  return page.evaluate(() => {
    const issues = []
    const vw = window.innerWidth
    for (const el of document.querySelectorAll('body *')) {
      const tag = el.tagName.toLowerCase()
      if (tag !== 'svg' && el.closest('svg')) continue
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      if (style.position === 'fixed') continue
      const box = el.getBoundingClientRect()
      if (box.width < 1 || box.height < 1) continue
      if (el.classList.contains('home-glow')) continue
      if (el.closest('.chart')) continue
      if (box.right > vw + 4 || box.left < -4) {
        issues.push({
          tag,
          cls: (el.getAttribute('class') || '').slice(0, 60),
          left: Math.round(box.left),
          right: Math.round(box.right),
        })
      }
    }
    return issues.slice(0, 8)
  })
}

async function contrastIssues(page) {
  return page.evaluate(() => {
    const parse = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/)
      if (!match) return null
      const parts = match[1]
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number)
      if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
    }
    const blend = (top, bottom) => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1,
    })
    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const v = value / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    const background = (el) => {
      const layers = []
      let node = el
      while (node && node !== document.documentElement) {
        const color = parse(getComputedStyle(node).backgroundColor)
        if (color && color.a > 0) layers.push(color)
        if (color && color.a >= 1) break
        node = node.parentElement
      }
      let base = { r: 11, g: 12, b: 14, a: 1 }
      for (let index = layers.length - 1; index >= 0; index -= 1) base = blend(layers[index], base)
      return base
    }

    const selectors = [
      '.hero__lead',
      '.eyebrow',
      '.section-head__note',
      '.mono-label',
      '.card__title a',
      '.card__price',
      '.card__specs .chip-spec',
      '.card__availability',
      '.card__spark-note',
      '.movement__name',
      '.movement__meta',
      '.range-row__label',
      '.range-row__count',
      '.range-row__pct',
      '.catalog-head__note',
      '.results-bar__count',
      '.check-row__text',
      '.check-row__count',
      '.filter-group__title',
      '.sort-btn__value',
      '.stat__key',
      '.stat__value',
      '.facts__key',
      '.facts__value',
      '.site-footer__left',
      '.site-footer__updated',
      '.site-nav__link',
      '.tab-bar__item',
      '.site-header__mobile-date',
      '.pagination__info',
      '.page-btn',
      '.hero-panel__key',
      '.hero-panel__figure',
      '.hero-panel__foot',
    ]

    const issues = []
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        const text = (el.textContent || '').trim()
        if (!text) continue
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (Number.parseFloat(style.opacity) === 0) continue
        const box = el.getBoundingClientRect()
        if (box.width < 1 || box.height < 1) continue
        const fg = parse(style.color)
        if (!fg) continue
        const bg = background(el)
        const effective = fg.a < 1 ? blend(fg, bg) : fg
        const l1 = luminance(effective)
        const l2 = luminance(bg)
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
        const size = Number.parseFloat(style.fontSize)
        const weight = Number.parseInt(style.fontWeight, 10) || 400
        const large = size >= 24 || (size >= 18.66 && weight >= 700)
        const required = large ? 3 : 4.5
        if (ratio + 0.01 < required) {
          issues.push({
            selector,
            text: text.slice(0, 36),
            ratio: Math.round(ratio * 100) / 100,
            required,
            size,
          })
        }
      }
    }
    return issues.slice(0, 10)
  })
}

async function chartMetrics(page) {
  return page.evaluate(() => {
    const read = (axis) =>
      [...document.querySelectorAll(`.chart__axis-text[data-axis="${axis}"]`)].map((el) => ({
        text: (el.textContent || '').trim(),
        size: Number.parseFloat(getComputedStyle(el).fontSize),
      }))
    return {
      hasChart: Boolean(document.querySelector('.chart')),
      y: read('y'),
      x: read('x'),
      future: Boolean(document.querySelector('.chart__future')),
      gaps: document.querySelectorAll('.chart__line--gap').length,
      milestones: [...document.querySelectorAll('.chart__milestone-label')].map((el) =>
        (el.textContent || '').trim()
      ),
      emptyNote: [...document.querySelectorAll('.chart__empty-note')].map((el) =>
        (el.textContent || '').trim()
      ),
    }
  })
}

function unique(values) {
  return new Set(values).size === values.length
}

/* ------------------------------------------------------------------ */
/* Datasets sintéticos                                                */
/* ------------------------------------------------------------------ */

const SYNTH_ATTRS = {
  cpu: 'AMD Ryzen 5 7600',
  ram: '16 GB DDR5',
  ssd: '1 TB SSD',
  marca: 'Synthetic',
}

function synthProduct(overrides) {
  const base = {
    sku: 'SYN-001',
    name: 'PC Sintético 001 · Ryzen 5 · 16 GB · 1 TB',
    shortName: 'Sintético 001',
    url: 'https://example.com/pc',
    currentPrice: 1000,
    pvpr: 1200,
    discountPvpr: 16.7,
    prevPrice: 1050,
    prevDate: '2026-11-26',
    deltaAbs: -50,
    deltaPct: -4.8,
    previousPrice: 1050,
    recentChangePct: -4.8,
    recentDropPct: 4.8,
    minPriceHistorico: 1000,
    maxPriceHistorico: 1100,
    firstPrice: 1100,
    lastPrice: 1000,
    totalRegistros: 2,
    numDiasHistorial: 2,
    availability: 'En stock',
    availabilityShort: 'En stock',
    attributes: { ...SYNTH_ATTRS },
    cpuFamily: 'Ryzen 5',
    firstSeen: '2026-11-26',
    lastSeen: '2026-11-27',
    isNew: false,
    isDiscontinued: false,
    lastUpdated: '2026-11-27 08:00:41',
    sparkline: [1050, 1000],
  }
  return { ...base, ...overrides, attributes: { ...SYNTH_ATTRS, ...(overrides.attributes || {}) } }
}

function isoDay(offsetFromStart, start = '2026-10-28') {
  const date = new Date(`${start}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offsetFromStart)
  return date.toISOString().slice(0, 10)
}

function buildOneDay(date = '2026-11-27') {
  const prices = [699, 899, 1099, 1299, 1599, 1999]
  const products = prices.map((price, index) =>
    synthProduct({
      sku: `SYN1-${index + 1}`,
      name: `PC Sintético un día ${index + 1}`,
      shortName: `Un día ${index + 1}`,
      currentPrice: price,
      pvpr: Math.round(price * 1.2),
      discountPvpr: 16.7,
      prevPrice: null,
      prevDate: null,
      deltaAbs: null,
      deltaPct: null,
      previousPrice: null,
      recentChangePct: null,
      recentDropPct: null,
      minPriceHistorico: price,
      maxPriceHistorico: price,
      firstPrice: price,
      lastPrice: price,
      totalRegistros: 1,
      numDiasHistorial: 1,
      firstSeen: date,
      lastSeen: date,
      isNew: true,
      lastUpdated: `${date} 08:00:41`,
      sparkline: [price],
    })
  )
  const history = Object.fromEntries(products.map((product) => [product.sku, [[date, product.currentPrice]]]))
  const meta = {
    generatedAt: `${date}T08:00:41Z`,
    lastScrape: date,
    lastScrapeTime: '08:00:41',
    scrapes: [{ date, time: '08:00:41', skus: products.length, withPrice: products.length, median: 1199, drops: 0 }],
    totals: {
      entries: products.length,
      active: products.length,
      discontinued: 0,
      withPrice: products.length,
      withPvpr: products.length,
    },
  }
  return { products, history, meta, focus: products[0].sku }
}

function buildTwoDays() {
  const dates = ['2026-11-26', '2026-11-27']
  const prices = [749, 949, 1149, 1349, 1649, 2049]
  const products = prices.map((price, index) => {
    const previous = price + (index % 2 === 0 ? 40 : 0)
    const delta = price - previous
    const pct = previous ? (delta / previous) * 100 : null
    return synthProduct({
      sku: `SYN2-${index + 1}`,
      name: `PC Sintético dos días ${index + 1}`,
      shortName: `Dos días ${index + 1}`,
      currentPrice: price,
      pvpr: Math.round(price * 1.2),
      prevPrice: previous,
      prevDate: dates[0],
      deltaAbs: delta,
      deltaPct: pct,
      previousPrice: previous,
      recentChangePct: pct,
      recentDropPct: delta < 0 ? Math.abs(pct) : null,
      minPriceHistorico: Math.min(price, previous),
      maxPriceHistorico: Math.max(price, previous),
      firstPrice: previous,
      lastPrice: price,
      totalRegistros: 2,
      numDiasHistorial: 2,
      firstSeen: dates[0],
      lastSeen: dates[1],
      sparkline: [previous, price],
    })
  })
  const history = Object.fromEntries(
    products.map((product) => [
      product.sku,
      [
        [dates[0], product.prevPrice],
        [dates[1], product.currentPrice],
      ],
    ])
  )
  const meta = {
    generatedAt: `${dates[1]}T08:00:41Z`,
    lastScrape: dates[1],
    lastScrapeTime: '08:00:41',
    scrapes: dates.map((date, index) => ({
      date,
      time: '08:00:41',
      skus: products.length,
      withPrice: products.length,
      median: index === 0 ? 1249 : 1219,
      drops: index === 0 ? 0 : 3,
    })),
    totals: {
      entries: products.length,
      active: products.length,
      discontinued: 0,
      withPrice: products.length,
      withPvpr: products.length,
    },
  }
  return { products, history, meta, focus: products[0].sku }
}

function buildThirtyDays() {
  const days = 31
  const dates = Array.from({ length: days }, (_, index) => isoDay(index))
  const last = dates[dates.length - 1]
  const products = []
  const history = {}

  for (let index = 0; index < 8; index += 1) {
    const sku = `SYN3-${index + 1}`
    const base = 800 + index * 260
    const series = dates.map((date, dayIndex) => {
      const wobble = Math.round(Math.sin((dayIndex + index) / 3) * 45)
      return [date, base + wobble + Math.round(dayIndex * 1.5)]
    })
    const gap = index === 2
    const discontinued = index === 4
    const isNew = index === 5
    let visible = series
    if (gap) visible = series.filter((_, dayIndex) => dayIndex < 10 || dayIndex > 14)
    if (isNew) visible = series.slice(25)
    if (discontinued) visible = series.slice(0, 24)

    const values = visible.map((entry) => entry[1])
    const current = values[values.length - 1]
    const previous = values.length > 1 ? values[values.length - 2] : null
    const delta = previous !== null ? current - previous : null
    const pct = previous ? (delta / previous) * 100 : null

    products.push(
      synthProduct({
        sku,
        name: `PC Sintético treinta días ${index + 1}`,
        shortName: `Treinta días ${index + 1}`,
        currentPrice: current,
        pvpr: Math.round(Math.max(...values) * 1.15),
        discountPvpr: 12.5,
        prevPrice: previous,
        prevDate: visible.length > 1 ? visible[visible.length - 2][0] : null,
        deltaAbs: delta,
        deltaPct: pct,
        previousPrice: previous,
        recentChangePct: pct,
        recentDropPct: delta !== null && delta < 0 ? Math.abs(pct) : null,
        minPriceHistorico: Math.min(...values),
        maxPriceHistorico: Math.max(...values),
        firstPrice: values[0],
        lastPrice: current,
        totalRegistros: visible.length,
        numDiasHistorial: visible.length,
        firstSeen: visible[0][0],
        lastSeen: visible[visible.length - 1][0],
        isNew,
        isDiscontinued: discontinued,
        lastUpdated: `${visible[visible.length - 1][0]} 08:00:41`,
        sparkline: values.slice(-30),
      })
    )
    history[sku] = visible
  }

  const scrapes = dates.map((date) => {
    const medians = []
    let drops = 0
    let skus = 0
    for (const product of products) {
      const entries = history[product.sku]
      const found = entries.find((entry) => entry[0] === date)
      if (!found) continue
      skus += 1
      medians.push(found[1])
      const position = entries.findIndex((entry) => entry[0] === date)
      if (position > 0 && entries[position][1] < entries[position - 1][1]) drops += 1
    }
    medians.sort((a, b) => a - b)
    const median = medians.length
      ? medians.length % 2
        ? medians[Math.floor(medians.length / 2)]
        : (medians[medians.length / 2 - 1] + medians[medians.length / 2]) / 2
      : null
    return { date, time: '08:00:41', skus, withPrice: skus, median, drops }
  })

  const meta = {
    generatedAt: `${last}T08:00:41Z`,
    lastScrape: last,
    lastScrapeTime: '08:00:41',
    scrapes,
    totals: {
      entries: products.length,
      active: products.filter((product) => !product.isDiscontinued).length,
      discontinued: products.filter((product) => product.isDiscontinued).length,
      withPrice: products.length,
      withPvpr: products.length,
    },
  }

  return {
    products,
    history,
    meta,
    focus: products[2].sku,
    gap: products[2].sku,
    discontinued: products[4].sku,
    fresh: products[5].sku,
  }
}

async function buildSyntheticSite(dataset) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pccom-check-'))
  const target = path.join(temp, 'scrapper-pccom')
  fs.cpSync(dist, target, { recursive: true })
  const dataDir = path.join(target, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'prices.json'), JSON.stringify(dataset.products))
  fs.writeFileSync(path.join(dataDir, 'history.json'), JSON.stringify(dataset.history))
  fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify(dataset.meta))
  return temp
}

/* ------------------------------------------------------------------ */
/* Comprobaciones                                                     */
/* ------------------------------------------------------------------ */

const VIEWPORTS = [
  { width: 390, height: 844, name: '390×844' },
  { width: 768, height: 1024, name: '768×1024' },
  { width: 1024, height: 768, name: '1024×768' },
  { width: 1280, height: 800, name: '1280×800' },
  { width: 1440, height: 900, name: '1440×900' },
  { width: 1920, height: 1080, name: '1920×1080' },
]

const EXPECTED_COLUMNS = { 390: 1, 768: 2, 1024: 2, 1280: 3, 1440: 3, 1920: 3 }

function expectedHeaderHeight(width) {
  return width < 640 ? 56 : 64
}

function expectedContentWidth(width) {
  if (width >= 1280) return 1216
  if (width >= 1024) return width - 64
  if (width >= 640) return width - 48
  return width - 40
}

async function checkCommon(page, label, width, errors) {
  const metrics = await measure(page)
  check(`${label} · sin scroll horizontal`, metrics.scrollWidth <= width + 1, `${metrics.scrollWidth}px`)

  if (metrics.container) {
    const expected = expectedContentWidth(width)
    check(
      `${label} · ancho de contenido ${expected}px`,
      Math.abs(metrics.container.width - expected) <= 1,
      `${metrics.container.width}px`
    )
  } else {
    check(`${label} · contenedor presente`, false)
  }

  if (metrics.header) {
    const expected = expectedHeaderHeight(width)
    check(
      `${label} · header ${expected}px`,
      Math.abs(metrics.header.height - expected) <= 1,
      `${metrics.header.height}px`
    )
    check(`${label} · header sticky`, metrics.headerPosition === 'sticky', metrics.headerPosition || '')
  } else {
    check(`${label} · header presente`, false)
  }

  if (width < 640) {
    check(`${label} · tab bar visible`, Boolean(metrics.tabBar), metrics.tabBar ? `${metrics.tabBar.height}px` : 'ausente')
    if (metrics.tabBar) {
      check(`${label} · tab bar altura 64`, Math.abs(metrics.tabBar.height - 64) <= 1, `${metrics.tabBar.height}px`)
      const touch = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.tab-bar__item')]
        return items.map((el) => {
          const box = el.getBoundingClientRect()
          return { width: Math.round(box.width), height: Math.round(box.height) }
        })
      })
      check(
        `${label} · tab bar áreas táctiles ≥64×48`,
        touch.length === 3 && touch.every((item) => item.width >= 64 && item.height >= 48),
        JSON.stringify(touch)
      )
    }
    const navHidden = await page.evaluate(() => {
      const nav = document.querySelector('.site-nav')
      if (!nav) return true
      return getComputedStyle(nav).display === 'none'
    })
    check(`${label} · nav de escritorio oculta`, navHidden)
    const wordmark = await page.evaluate(() => {
      const el = document.querySelector('.wordmark')
      return el ? Math.round(el.getBoundingClientRect().height) : 0
    })
    check(`${label} · wordmark ≥44px`, wordmark >= 44, `${wordmark}px`)
  } else {
    check(`${label} · sin tab bar`, !metrics.tabBar)
    const navVisible = await page.evaluate(() => {
      const nav = document.querySelector('.site-nav')
      return nav ? getComputedStyle(nav).display !== 'none' : false
    })
    check(`${label} · nav de escritorio visible`, navVisible)
  }

  const fonts = metrics.fonts
  check(`${label} · fuente Geist cargada`, fonts.geist)
  check(`${label} · fuente Geist Mono cargada`, fonts.geistMono)
  check(`${label} · fuente Instrument Serif cargada`, fonts.instrument)

  const fontProblems = await fontIssues(page)
  check(
    `${label} · tipografía mínima 11px`,
    fontProblems.length === 0,
    fontProblems.length ? JSON.stringify(fontProblems.slice(0, 3)) : ''
  )

  const overflow = await overflowIssues(page)
  check(
    `${label} · sin desbordamientos inesperados`,
    overflow.length === 0,
    overflow.length ? JSON.stringify(overflow.slice(0, 3)) : ''
  )

  const contrast = await contrastIssues(page)
  check(
    `${label} · contraste ≥4.5`,
    contrast.length === 0,
    contrast.length ? JSON.stringify(contrast.slice(0, 3)) : ''
  )

  check(`${label} · sin errores de consola`, errors.length === 0, errors.slice(0, 2).join(' | '))
}

function checkChart(label, chart, { expectFuture = null, expectGap = false } = {}) {
  check(`${label} · gráfica presente`, chart.hasChart)
  if (!chart.hasChart) return
  check(
    `${label} · eje Y entre 4 y 6 ticks`,
    chart.y.length >= 4 && chart.y.length <= 6,
    `${chart.y.length}`
  )
  check(
    `${label} · eje Y sin duplicados`,
    unique(chart.y.map((tick) => tick.text)),
    chart.y.map((tick) => tick.text).join(' · ')
  )
  check(
    `${label} · eje Y mono 11`,
    chart.y.every((tick) => tick.size >= 11),
    chart.y.map((tick) => tick.size).join(',')
  )
  check(
    `${label} · eje X entre 2 y 7 ticks`,
    chart.x.length >= 2 && chart.x.length <= 7,
    `${chart.x.length}`
  )
  check(
    `${label} · eje X sin duplicados`,
    unique(chart.x.map((tick) => tick.text)),
    chart.x.map((tick) => tick.text).join(' · ')
  )
  check(
    `${label} · eje X mono 11`,
    chart.x.every((tick) => tick.size >= 11),
    chart.x.map((tick) => tick.size).join(',')
  )
  if (expectFuture !== null) {
    check(`${label} · zona futura ${expectFuture ? 'presente' : 'ausente'}`, chart.future === expectFuture)
  }
  if (expectGap) {
    check(`${label} · tramo discontinuo`, chart.gaps >= 1, `${chart.gaps}`)
  }
}

async function checkRealData(browser, base) {
  const prices = JSON.parse(fs.readFileSync(path.join(dist, 'data', 'prices.json'), 'utf8'))
  const history = JSON.parse(fs.readFileSync(path.join(dist, 'data', 'history.json'), 'utf8'))
  const withSeries = prices.find(
    (product) => !product.isDiscontinued && Array.isArray(history[product.sku]) && history[product.sku].length >= 2
  )
  const sku = withSeries ? withSeries.sku : prices[0].sku

  for (const viewport of VIEWPORTS) {
    section(`Datos reales · ${viewport.name}`)
    const { context, page, errors } = await newPage(browser, viewport)
    const width = viewport.width

    // Home
    errors.length = 0
    await go(page, base, '.hero')
    await checkCommon(page, `Home ${viewport.name}`, width, errors)
    const homeChart = await chartMetrics(page)
    checkChart(`Home ${viewport.name}`, homeChart, { expectFuture: true })
    check(
      `Home ${viewport.name} · h1 Instrument Serif`,
      /Instrument Serif/.test((await measure(page)).fonts.h1 || ''),
      (await measure(page)).fonts.h1 || ''
    )

    // Catálogo
    errors.length = 0
    await go(page, `${base}#/catalogo`, '.catalog-layout')
    const catalog = await measure(page)
    await checkCommon(page, `Catálogo ${viewport.name}`, width, errors)
    const expectedColumns = EXPECTED_COLUMNS[width]
    check(
      `Catálogo ${viewport.name} · ${expectedColumns} columnas`,
      catalog.columns === expectedColumns,
      `${catalog.columns}`
    )
    if (width >= 1024) {
      check(`Catálogo ${viewport.name} · filtros visibles`, Boolean(catalog.filters))
    } else {
      check(`Catálogo ${viewport.name} · filtros ocultos`, !catalog.filters)
    }
    if (width === 1440) {
      check(
        'Catálogo 1440 · tarjeta 288±2px',
        catalog.card !== null && Math.abs(catalog.card.width - 288) <= 2,
        catalog.card ? `${catalog.card.width}px` : 'sin tarjeta'
      )
    }
    if (catalog.card && width >= 640) {
      check(`Catálogo ${viewport.name} · tarjeta ≥260px`, catalog.card.width >= 260, `${catalog.card.width}px`)
    }

    // Producto
    errors.length = 0
    await go(page, `${base}#/product/${encodeURIComponent(sku)}`, '.product-head')
    await checkCommon(page, `Producto ${viewport.name}`, width, errors)
    const productChart = await chartMetrics(page)
    checkChart(`Producto ${viewport.name}`, productChart, { expectFuture: true })
    const productFont = await page.evaluate(() => {
      const el = document.querySelector('.product-head h1')
      return el ? getComputedStyle(el).fontFamily : ''
    })
    check(`Producto ${viewport.name} · h1 Geist`, /Geist/.test(productFont), productFont)

    // Favoritos vacío
    errors.length = 0
    await go(page, `${base}#/favoritos`, '.favorites-head')
    await checkCommon(page, `Favoritos ${viewport.name}`, width, errors)
    const empty = await page.evaluate(() => Boolean(document.querySelector('.empty h1')))
    check(`Favoritos ${viewport.name} · estado vacío`, empty)

    // Ruta heredada #/listado
    errors.length = 0
    await go(page, `${base}#/listado`, '.catalog-layout')
    check(`Ruta heredada ${viewport.name} · #/listado abre catálogo`, errors.length === 0, errors[0] || '')

    await context.close()
  }

  // Interacciones de escritorio
  section('Interacciones · 1440×900')
  {
    const { context, page, errors } = await newPage(browser, { width: 1440, height: 900 })
    await go(page, `${base}#/catalogo`, '.catalog-layout')

    const firstBefore = await page.locator('[data-card="true"] .card__title a').first().textContent()
    await page.locator('.sort-btn').click()
    check('Ordenar · menú se abre', await page.locator('.sort-menu').isVisible())
    await page.locator('.sort-menu__item', { hasText: 'Precio: menor a mayor' }).click()
    await page.waitForTimeout(120)
    check('Ordenar · menú se cierra', !(await page.locator('.sort-menu').isVisible()))
    const firstAfter = await page.locator('[data-card="true"] .card__title a').first().textContent()
    check('Ordenar · cambia el orden', firstBefore !== firstAfter, `${firstBefore} → ${firstAfter}`)

    const info = await page.locator('.pagination__info').textContent()
    check('Paginación · página 1 empieza en 1', (info || '').trim().startsWith('1'), (info || '').trim())
    await page.locator('.page-btn', { hasText: '2' }).first().click()
    await page.waitForTimeout(150)
    const info2 = await page.locator('.pagination__info').textContent()
    check('Paginación · página 2 empieza en 49', (info2 || '').trim().startsWith('49'), (info2 || '').trim())

    // Favoritos
    await page.locator('.card__fav').first().click()
    await page.waitForTimeout(120)
    const navCount = await page.locator('.site-nav__count').textContent().catch(() => null)
    check('Favoritos · contador en nav', navCount === '1', navCount || 'sin contador')
    await page.goto(`${base}#/favoritos`, { waitUntil: 'load' })
    await page.waitForSelector('.favorites-head')
    check('Favoritos · tarjeta guardada visible', (await page.locator('[data-card="true"]').count()) === 1)
    await page.evaluate(() => localStorage.clear())

    // Restauración de scroll al volver del producto
    await page.goto(`${base}#/catalogo`, { waitUntil: 'load' })
    await page.waitForSelector('.catalog-layout')
    const point = await page.evaluate(() => {
      window.scrollTo(0, 900)
      const links = [...document.querySelectorAll('[data-card="true"] .card__title a')]
      const target = links.find((el) => {
        const box = el.getBoundingClientRect()
        return box.top > 120 && box.bottom < window.innerHeight - 120
      })
      if (!target) return null
      const box = target.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    })
    await page.waitForTimeout(250)
    const scrolled = await page.evaluate(() => window.scrollY)
    if (point) await page.mouse.click(point.x, point.y)
    else await page.locator('[data-card="true"] .card__title a').first().click()
    await page.waitForSelector('.product-head')
    await page.locator('.back-link').click()
    await page.waitForSelector('.catalog-layout')
    await page.waitForTimeout(500)
    const restored = await page.evaluate(() => window.scrollY)
    check(
      'Volver del producto · restaura el scroll',
      Math.abs(restored - scrolled) <= 80,
      `${scrolled} → ${restored}`
    )

    // ?sku= heredado
    await page.goto(`${base}#/product?sku=${encodeURIComponent(sku)}`, { waitUntil: 'load' })
    await page.waitForSelector('.product-head')
    check('Ruta heredada · ?sku= abre ficha', (await page.locator('.product-head').count()) === 1)

    check('Escritorio · sin errores de consola', errors.length === 0, errors.slice(0, 2).join(' | '))
    await context.close()
  }

  // Interacciones móviles
  section('Interacciones · 390×844')
  {
    const { context, page, errors } = await newPage(browser, { width: 390, height: 844 })
    await go(page, `${base}#/catalogo`, '.catalog-layout')
    await page.locator('.mobile-filter-btn').click()
    await page.waitForTimeout(400)
    check('Móvil · bottom sheet abierto', await page.locator('.sheet.is-open').isVisible())
    check('Móvil · scroll bloqueado', await page.evaluate(() => document.body.classList.contains('is-locked')))
    const focusedInside = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet')
      return Boolean(sheet && document.activeElement && sheet.contains(document.activeElement))
    })
    check('Móvil · foco dentro del sheet', focusedInside)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(450)
    check('Móvil · Escape cierra el sheet', !(await page.locator('.sheet.is-open').isVisible()))
    check('Móvil · scroll liberado', await page.evaluate(() => !document.body.classList.contains('is-locked')))
    check('Móvil · sin errores de consola', errors.length === 0, errors.slice(0, 2).join(' | '))
    await context.close()
  }

  // Movimiento real (sin reduced-motion) y gráfica con teclado
  section('Movimiento y teclado · 1440×900')
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const errors = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.goto(base, { waitUntil: 'load' })
    await page.waitForSelector('.hero')
    await page.waitForTimeout(1400)
    const heroTransform = await page.evaluate(() => {
      const span = document.querySelector('.hero__line > span')
      return span ? getComputedStyle(span).transform : null
    })
    check(
      'Movimiento · hero termina en su sitio',
      heroTransform === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(heroTransform || ''),
      heroTransform || 'sin span'
    )
    await page.evaluate(() => window.scrollTo(0, 900))
    await page.waitForTimeout(1400)
    const dash = await page.evaluate(() => {
      const line = document.querySelector('.chart__line')
      return line ? getComputedStyle(line).strokeDashoffset : null
    })
    check('Movimiento · línea dibujada', dash !== null && (dash === '0px' || dash === '0'), dash || 'sin línea')
    await page.locator('.chart__svg').focus()
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(200)
    const tooltip = await page.locator('.chart-tooltip').isVisible().catch(() => false)
    const live = await page.locator('.chart [aria-live="polite"]').textContent().catch(() => '')
    check(
      'Gráfica · tooltip y aria-live con teclado',
      tooltip && (live || '').trim().length > 0,
      (live || '').trim().slice(0, 70)
    )
    check('Movimiento · sin errores de consola', errors.length === 0, errors.slice(0, 2).join(' | '))
    await context.close()
  }

  return sku
}

/* ------------------------------------------------------------------ */
/* Comprobaciones sintéticas                                          */
/* ------------------------------------------------------------------ */

async function checkSynthetic(browser, dataset, name, expectations) {
  section(`Sintético · ${name}`)
  const dir = await buildSyntheticSite(dataset)
  const { server, port } = await serveStatic(dir)
  const base = `http://127.0.0.1:${port}${BASE_PATH}`
  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const { context, page, errors } = await newPage(browser, viewport)
      await go(page, base, '.hero')
      const metrics = await measure(page)
      check(
        `Sintético ${name} ${viewport.width} · sin scroll horizontal`,
        metrics.scrollWidth <= viewport.width + 1,
        `${metrics.scrollWidth}px`
      )
      if (expectations.stale) {
        const strip = await page.evaluate(() => {
          const el = document.querySelector('.stale-strip')
          if (!el) return null
          const box = el.getBoundingClientRect()
          return { text: (el.textContent || '').trim(), height: Math.round(box.height) }
        })
        check(
          `Sintético ${name} · franja de datos obsoletos`,
          Boolean(strip) && /hace 8 días/.test(strip.text) && Math.abs(strip.height - 36) <= 1,
          strip ? `${strip.text} · ${strip.height}px` : 'ausente'
        )
      }
      check(`Sintético ${name} ${viewport.width} · sin errores`, errors.length === 0, errors.slice(0, 2).join(' | '))
      await context.close()
    }

    const { context, page, errors } = await newPage(browser, { width: 1440, height: 900 })
    await go(page, `${base}#/product/${encodeURIComponent(dataset.focus)}`, '.product-head')
    const chart = await chartMetrics(page)
    checkChart(`Sintético ${name}`, chart, expectations.chart || {})
    if (expectations.singlePoint) {
      check(
        `Sintético ${name} · texto de 1 día`,
        chart.emptyNote.some((note) => /Historial en construcción · 1 día/.test(note)),
        chart.emptyNote.join(' | ')
      )
    }
    if (expectations.milestone) {
      check(
        `Sintético ${name} · hito Black Friday`,
        chart.milestones.some((label) => /Black Friday/.test(label)),
        chart.milestones.join(' | ')
      )
    }
    check(`Sintético ${name} · ficha sin errores`, errors.length === 0, errors.slice(0, 2).join(' | '))
    await context.close()

    if (dataset.discontinued) {
      const detail = await newPage(browser, { width: 1440, height: 900 })
      await go(detail.page, `${base}#/product/${encodeURIComponent(dataset.discontinued)}`, '.product-head')
      const badges = await detail.page.evaluate(() =>
        [...document.querySelectorAll('.badge')].map((el) => (el.textContent || '').trim())
      )
      check(
        `Sintético ${name} · badge descatalogado`,
        badges.some((label) => /Descatalogado/i.test(label)),
        badges.join(' | ')
      )
      await detail.context.close()
    }

    if (dataset.fresh) {
      const detail = await newPage(browser, { width: 1440, height: 900 })
      await go(detail.page, `${base}#/product/${encodeURIComponent(dataset.fresh)}`, '.product-head')
      const badges = await detail.page.evaluate(() =>
        [...document.querySelectorAll('.badge')].map((el) => (el.textContent || '').trim())
      )
      check(
        `Sintético ${name} · badge nuevo`,
        badges.some((label) => /Nuevo/i.test(label)),
        badges.join(' | ')
      )
      await detail.context.close()
    }
  } finally {
    server.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

let preview
let browser
try {
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error('No existe dist/. Ejecuta `vite build` antes de check-layout.')
  }
  section('Arranque')
  const started = await startPreview()
  preview = started.proc
  console.log(`  vite preview en ${started.url}`)
  browser = await chromium.launch()

  const sku = await checkRealData(browser, started.url)

  await checkSynthetic(browser, buildOneDay(), '1 día', {
    singlePoint: true,
    chart: { expectFuture: false, expectGap: false },
  })
  await checkSynthetic(browser, buildTwoDays(), '2 días', {
    chart: { expectFuture: true, expectGap: false },
  })
  await checkSynthetic(browser, buildThirtyDays(), '31 días', {
    milestone: true,
    chart: { expectFuture: false, expectGap: true },
  })
  await checkSynthetic(browser, buildOneDay('2026-11-20'), 'obsoleto', {
    singlePoint: true,
    stale: true,
    chart: { expectFuture: false, expectGap: false },
  })

  console.log(`\nSKU real usado en las fichas: ${sku}`)
} catch (error) {
  failures += 1
  console.error('\nError fatal:', error)
} finally {
  if (browser) await browser.close().catch(() => undefined)
  stopProcess(preview)
}

console.log('\n================ RESUMEN ================')
console.log(`Comprobaciones: ${results.length} · Fallos: ${failures}`)
const failed = results.filter((result) => !result.ok)
if (failed.length) {
  console.log('\nFallos:')
  for (const item of failed) console.log(`  · ${item.name}${item.detail ? ` — ${item.detail}` : ''}`)
}
process.exit(failures ? 1 : 0)
