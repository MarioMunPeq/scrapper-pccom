#!/usr/bin/env node
/**
 * Build script para web/ - Genera web/public/data/prices.json
 * Lee ../data/history.csv y products.json
 * Si el histórico tiene menos de 3 días, usa datos de muestra deterministas.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data');

const HISTORY_FILE = path.join(DATA_DIR, 'history.csv');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const PRICES_OUTPUT = path.join(PUBLIC_DATA_DIR, 'prices.json');

// Fechas fijas para los marcadores
const BLACK_FRIDAY = new Date('2026-11-27');
const CYBER_MONDAY = new Date('2026-11-30');
const CHRISTMAS = new Date('2026-12-25');
const REYES = new Date('2027-01-06');
const JANUARY_SALES_START = new Date('2027-01-05');

// Regex para extraer atributos del nombre del producto
const ATTR_REGEX = {
  cpu: /(Intel|AMD|Core|Ryzen)\s+\w+(?:\s+\w+)?/gi,
  ram: /(\d+)\s*GB\s*RAM/gi,
  ssd: /(\d+)\s*TB\s*SSD|(\d+)\s*GB\s*SSD/gi,
  marca: /(PcCom|Vibox|PCM|Aeon|NeoPC|Gamer|Gaming|Centrum)/gi,
};

/**
 * Extrae atributos del nombre del producto usando regex
 */
function extractAttributes(name) {
  const result = { cpu: '', ram: '', ssd: '', marca: '' };
  const matches = name.match(ATTR_REGEX);
  if (matches) {
    for (const m of matches) {
      const upper = m.toUpperCase();
      if (/PCCOM|VIBOX|PCM|AEON|NEOPC|GAMER|GAMING|CENTRUM/i.test(m)) result.marca = m;
      if (/INTEL|AMD|CORE|RYZEN/i.test(m)) result.cpu = m;
      if (/\d+\s*GB\s*RAM/i.test(m)) result.ram = m;
      if (/\d+\s*TB\s*SSD|\d+\s*GB\s*SSD/i.test(m)) result.ssd = m;
    }
  }
  return result;
}

/**
 * Clasifica GPU: 'ti' para RTX 5070 Ti, '5070' para RTX 5070, null para otro
 */
function classifyGpu(name) {
  if (/RTX\s+5070\s*Ti\b/gi.test(name)) return 'ti';
  if (/RTX\s+5070(?!Ti)/gi.test(name)) return '5070';
  return null;
}

/**
 * Obtiene la variación simulada en 7 días
 */
function get7dVariation(current, historicalPrices) {
  if (historicalPrices.length < 2) return 0;
  const sorted = [...historicalPrices].sort((a, b) => a - b);
  const oldPrice = sorted[Math.max(0, sorted.length - 2)];
  if (!oldPrice || oldPrice === current) return 0;
  return Math.round(((current - oldPrice) / oldPrice) * 100);
}

/**
 * Obtiene la fecha formateada dd/mm */
function formatDateMd(d) {
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/**
 * Detecta si la fecha es un hito conocido y devuelve la etiqueta */
function isHito(date) {
  const d = new Date(date);
  if (d.getDate() === BLACK_FRIDAY.getDate() && d.getMonth() === BLACK_FRIDAY.getMonth())
    return 'Black Friday (27/11)';
  if (d.getDate() === CYBER_MONDAY.getDate() && d.getMonth() === CYBER_MONDAY.getMonth())
    return 'Cyber Monday (30/11)';
  if (d.getDate() === CHRISTMAS.getDate() && d.getMonth() === CHRISTMAS.getMonth())
    return 'Navidad (25/12)';
  if (d.getDate() === REYES.getDate() && d.getMonth() === REYES.getMonth())
    return 'Reyes (6/1)';
  if (d >= JANUARY_SALES_START) return 'Rebajas enero';
  return null;
}

/**
 * Parses un precio string a número (quita €, separadores de miles).
 * - Formato español: "1.799,00" -> 1799.00
 * - Formato internacional: "2489.00" -> 2489.00
 * - Si tiene coma, es formato español (punto = miles, coma = decimal).
 * - Si tiene un solo punto con 2 dígitos decimales, es formato internacional.
 * - Si tiene un solo punto con 3+ dígitos, es separador de miles (formato español sin decimales).
 */
function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);

  if (text.includes('€')) {
    text = text.replace('€', '').trim();
  }

  let processed = text;

  if (processed.includes(',')) {
    // Formato español: "1.799,00" -> 1799.00
    // Quitar puntos (separadores de miles) y reemplazar coma por punto (decimal)
    processed = processed.replace(/\./g, '').replace(',', '.');
  } else if (processed.match(/^\d+\.\d{2}$/)) {
    // Formato internacional exacto "2489.00" -> 2489 (punto es decimal, no tocher)
    processed = processed; // No hacer nada
  } else if (processed.match(/^\d+\.\d{3}$/)) {
    // Formato "1.799" (punto miles, sin decimales) -> 1799
    processed = processed.replace(/\./g, '');
  } else if (processed.match(/^\d+\.\d+$/) && processed.split('.')[1].length >= 3) {
    // Punto decimal con 3+ dígitos o formato mixto: tratar como español
    processed = processed.replace(/\./g, '').replace(',', '.');
  }

  const num = parseFloat(processed);
  return isNaN(num) ? null : num;
}

/**
 * Calcula el porcentaje de máxima bajada respecto al precio más alto */
function maxDrop(prices) {
  if (prices.length < 2) return 0;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max === min) return 0;
  return Math.round(((max - min) / max) * 100);
}

/* --- CSV Parser simple (sin dependencias externas) --- */
function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = j < values.length ? values[j] : '';
    }
    rows.push(row);
  }
  return rows;
}

/* --- Lógica principal --- */

// Leer history.csv
let historyRows = [];
try {
  const historyContent = fs.readFileSync(HISTORY_FILE, 'utf-8');
  historyRows = parseCSV(historyContent).filter(r => r.fecha && r.sku);
} catch (e) {
  console.warn('No se pudo leer history.csv', e.message);
}

// Leer products.json
let products = {};
try {
  const productsContent = fs.readFileSync(PRODUCTS_FILE, 'utf-8');
  products = JSON.parse(productsContent);
} catch (e) {
  console.warn('No se pudo leer products.json', e.message);
}

// Determinar si hay suficientes datos históricos
const today = new Date();
const fechas = [...new Set(historyRows.map(r => r.fecha))].sort();

if (fechas.length < 3) {
  console.log(`Solo ${fechas.length} día(s) histórico. Usando datos de muestra deterministas.`);

  // Datos de muestra deterministas
  const samplePrices = [
    {
      sku: '11011276',
      name: 'PcCom Imperial AMD Ryzen 7 5700X / RTX 5070 / Windows 11 Home',
      currentPrice: 1799.0,
      previousPrice: 2299.0,
      discount: 22,
      attributes: extractAttributes('PcCom Imperial AMD Ryzen 7 5700X / RTX 5070 / Windows 11 Home'),
      minPriceHistorico: Math.round(1799 * 0.7),
      maxPriceHistorico: Math.round(1799 * 1.3),
      variation7d: 0,
      totalRegistros: 1,
      esMuestra: true,
      motivoMuestra:
        'Datos insuficientes en el histórico real (< 3 días). Se muestran datos de ejemplo deterministas para demostrar la funcionalidad.',
    },
    {
      sku: '10650846',
      name: 'PCM Interceptor Intel Core i7-12700KF/32GB/1TB SSD/RTX 5070 12GB',
      currentPrice: 2489.0,
      previousPrice: 3659.0,
      discount: 32,
      attributes: extractAttributes('PCM Interceptor Intel Core i7-12700KF/32GB/1TB SSD/RTX 5070 12GB'),
      minPriceHistorico: Math.round(2489 * 0.7),
      maxPriceHistorico: Math.round(2489 * 1.3),
      variation7d: 0,
      totalRegistros: 1,
      esMuestra: true,
      motivoMuestra:
        'Datos insuficientes en el histórico real (< 3 días). Se muestran datos de ejemplo deterministas para demostrar la funcionalidad.',
    },
  ];

  fs.mkdirSync(path.dirname(PRICES_OUTPUT), { recursive: true });
  fs.writeFileSync(PRICES_OUTPUT, JSON.stringify(samplePrices, null, 2));
  console.log('Generated prices.json con datos de muestra');
  process.exit(0);
}

// Procesar datos reales
const pricesData = [];
const skus = [...new Set(historyRows.map(r => r.sku))];

for (const sku of skus) {
  const skuRows = historyRows.filter(r => r.sku === sku).sort(
    (a, b) => new Date(a.fecha) - new Date(b.fecha)
  );
  const product = products[sku];
  const name = product ? product.name : `Producto ${sku}`;

  if (!name) continue;

  // Extraer precios de la columna 'precio'
  const prices = skuRows
    .map(r => parsePrice(r.precio))
    .filter(p => p !== null);

  // Precios anteriores (PVPR) de la columna 'precio_anterior'
  const preciosAnteriores = skuRows
    .filter(r => r.precio_anterior)
    .map(r => parsePrice(r.precio_anterior))
    .filter(p => p !== null);

  // Descuentos de la columna 'descuento'
  const descuentos = skuRows
    .filter(r => r.descuento)
    .map(r => {
      const d = parseInt(r.descuento, 10);
      return !isNaN(d) ? d : null;
    })
    .filter(d => d !== null);

  const currentPrice = prices[prices.length - 1] || null;
  const minPriceHistorico = prices.length > 0 ? Math.min(...prices) : null;
  const maxPriceHistorico = prices.length > 0 ? Math.max(...prices) : null;
  const discountActual = descuentos.length > 0 ? Math.max(...descuentos) : null;
  const dropPorcentaje = currentPrice && maxPriceHistorico && maxPriceHistorico > currentPrice
    ? Math.round(((maxPriceHistorico - currentPrice) / maxPriceHistorico) * 100)
    : 0;

  const variation7d = get7dVariation(currentPrice || 0, prices);
  const totalRegistros = skuRows.length;

  // Extraer atributos del nombre
  const attributes = extractAttributes(name);

  // Detectar el hito más reciente
  const hitoMasRecente = skuRows
    .filter(r => r.fecha)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .reverse()[0];

  const hitoInfo = hitoMasRecente ? isHito(hitoMasRecente.fecha) : null;

  pricesData.push({
    sku,
    name,
    currentPrice,
    previousPrice: prices.length > 1 ? prices[prices.length - 2] : null,
    discount: discountActual,
    minPriceHistorico,
    maxPriceHistorico,
    variation7d,
    totalRegistros,
    attributes,
    hito: hitoInfo,
    esMuestra: false,
    motivoMuestra: '',
  });
}

// Ordenar por SKU
pricesData.sort((a, b) => a.sku.localeCompare(b.sku));

// Asegurar directorio
fs.mkdirSync(path.dirname(PRICES_OUTPUT), { recursive: true });

// Escribir fichero
fs.writeFileSync(PRICES_OUTPUT, JSON.stringify(pricesData, null, 2));
console.log(`Generated prices.json con ${pricesData.length} productos (datos reales)`);
process.exit(0);