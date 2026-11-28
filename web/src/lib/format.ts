const euro0 = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
  useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions)

const euro2 = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions)

const whole = new Intl.NumberFormat('es-ES', {
  maximumFractionDigits: 0,
  useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions)

const oneDecimal = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export const MINUS = '\u2212'
export const THIN_SPACE = '\u2009'
export const NBSP = '\u00a0'

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return euro0.format(value)
}

export function formatPrice2(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return euro2.format(value)
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return whole.format(value)
}

export function formatSignedPrice(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? MINUS : ''
  return `${sign}${decimals === 2 ? euro2.format(Math.abs(value)) : euro0.format(Math.abs(value))}`
}

/** "−4,6 %" con menos U+2212 y espacio fino antes del símbolo. */
export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const sign = value < 0 ? MINUS : ''
  return `${sign}${oneDecimal.format(Math.abs(value))}${THIN_SPACE}%`
}

export function formatPctAbs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${oneDecimal.format(Math.abs(value))}${THIN_SPACE}%`
}

export function formatSignedPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? MINUS : ''
  return `${sign}${oneDecimal.format(Math.abs(value))}${THIN_SPACE}%`
}

/** "−120 € (−4,6 %)" */
export function formatDelta(
  abs: number | null | undefined,
  pct: number | null | undefined
): string {
  if (abs === null || abs === undefined || !Number.isFinite(abs)) return '—'
  const price = `${formatSignedPrice(abs, 0)}`
  return pct === null || pct === undefined || !Number.isFinite(pct)
    ? price
    : `${price} (${formatPct(pct)})`
}

/** "2.000–2.250 €" */
export function formatPriceRange(from: number, to: number): string {
  return `${whole.format(from)}–${whole.format(to)}${NBSP}€`
}

export function formatRangeValue(from: number, to: number): string {
  return `${whole.format(from)}–${whole.format(to)}${NBSP}€`
}

export function parseISO(iso: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!iso) return null
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return { y, m, d }
}

/** "26/11/2026" */
export function formatDate(iso: string | null | undefined): string {
  const p = parseISO(iso)
  if (!p) return '—'
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`
}

/** "26 nov" */
export function formatDayMonth(iso: string | null | undefined): string {
  const p = parseISO(iso)
  if (!p) return '—'
  return `${p.d} ${MONTHS[p.m - 1]}`
}

/** "jue 26 nov 2026" */
export function formatFullDate(iso: string | null | undefined): string {
  const p = parseISO(iso)
  if (!p) return '—'
  const weekday = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]
  return `${weekday} ${p.d} ${MONTHS[p.m - 1]} ${p.y}`
}

/** "2026-11-26 09:26:55" → "26/11/2026 09:26" */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const [date, time] = value.split(' ')
  const clock = time ? time.slice(0, 5) : ''
  return clock ? `${formatDate(date)} ${clock}` : formatDate(date)
}

export function formatClock(value: string | null | undefined): string {
  if (!value) return '—'
  const time = value.split(' ')[1]
  return time ? time.slice(0, 5) : '—'
}

export function dayNumber(iso: string): number {
  const p = parseISO(iso)
  if (!p) return NaN
  return Date.UTC(p.y, p.m - 1, p.d) / 86_400_000
}

export function isoFromDay(day: number): string {
  return new Date(Math.round(day) * 86_400_000).toISOString().slice(0, 10)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(dayNumber(toIso) - dayNumber(fromIso))
}

export function plural(count: number, singular: string, pluralWord: string): string {
  return count === 1 ? singular : pluralWord
}
