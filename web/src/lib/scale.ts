import { dayNumber, formatDayMonth, isoFromDay } from './format'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface Axis {
  min: number
  max: number
  ticks: number[]
}

const NICE_FACTORS = [1, 2, 2.5, 5]

function candidateSteps(span: number): number[] {
  const steps: number[] = []
  if (!Number.isFinite(span) || span <= 0) return [1]
  const startPower = Math.floor(Math.log10(span / 24))
  for (let power = startPower; power <= startPower + 4; power++) {
    for (const factor of NICE_FACTORS) {
      const step = factor * 10 ** power
      if (step > 0 && Number.isFinite(step)) steps.push(step)
    }
  }
  return [...new Set(steps)].sort((a, b) => a - b)
}

/**
 * Dominio con 4 % de margen por lado y rango mínimo del 2 % del valor medio
 * (o 20 € si la serie es plana). Ticks agradables 1/2/2,5/5 × 10^k, entre 4 y 6.
 */
export function buildAxis(values: number[]): Axis {
  const clean = values.filter((value) => Number.isFinite(value))
  if (!clean.length) return { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] }

  let lo = Math.min(...clean)
  let hi = Math.max(...clean)
  const mean = (lo + hi) / 2
  const minRange = Math.max(20, Math.abs(mean) * 0.02)
  if (hi - lo < minRange) {
    lo = mean - minRange / 2
    hi = mean + minRange / 2
  }
  const pad = (hi - lo) * 0.04
  lo -= pad
  hi += pad

  const steps = candidateSteps(hi - lo)
  let best: { ticks: number[]; step: number } | null = null
  let fallback: { ticks: number[]; step: number; distance: number } | null = null

  for (const step of steps) {
    const start = Math.ceil(lo / step) * step
    const end = Math.floor(hi / step) * step
    if (end < start) continue
    const ticks: number[] = []
    for (let value = start; value <= end + step / 2; value += step) {
      const rounded = Math.round(value * 1000) / 1000
      if (!ticks.some((tick) => Math.abs(tick - rounded) < step / 1000)) ticks.push(rounded)
    }
    if (ticks.length < 2) continue

    const labels = new Set(ticks.map((tick) => formatAxisEuro(tick)))
    if (ticks.length >= 4 && ticks.length <= 6 && labels.size === ticks.length) {
      if (!best || ticks.length >= best.ticks.length) best = { ticks, step }
    }
    const distance = Math.abs(ticks.length - 5)
    if (!fallback || distance < fallback.distance) fallback = { ticks, step, distance }
  }

  const chosen = best || fallback
  if (!chosen) {
    const start = Math.ceil(lo)
    const end = Math.floor(hi)
    return { min: lo, max: hi, ticks: [start, end] }
  }
  return { min: lo, max: hi, ticks: chosen.ticks }
}

/** Etiqueta del eje Y: euros completos sin decimales ("2.480 €"). */
export function formatAxisEuro(value: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
    useGrouping: 'always',
  } as unknown as Intl.NumberFormatOptions).format(value)
}

const DAY_STEPS = [1, 2, 7, 14, 30]

/** Pasos temporales reales: 1 d, 2 d, 1 sem, 2 sem, 1 mes, el menor con ≤7 etiquetas. */
export function buildTimeTicks(startDay: number, endDay: number): number[] {
  const span = endDay - startDay
  if (!Number.isFinite(span) || span < 0) return []
  if (span === 0) return [startDay]

  for (const step of DAY_STEPS) {
    const ticks: number[] = []
    for (let day = startDay; day <= endDay + 0.0001; day += step) ticks.push(day)
    const labels = new Set(ticks.map((day) => formatDayMonth(isoFromDay(day))))
    if (ticks.length >= 2 && ticks.length <= 7 && labels.size === ticks.length) return ticks
  }

  // Dominios muy largos: un mes como paso máximo, recortando el comienzo.
  const ticks: number[] = []
  for (let day = startDay; day <= endDay + 0.0001; day += 30) ticks.push(day)
  if (ticks.length <= 7) return ticks
  const stride = Math.ceil(ticks.length / 7)
  return ticks.filter((_, index) => index % stride === 0)
}

/** Mediana de los intervalos entre fechas consecutivas (en días). */
export function medianInterval(days: number[]): number {
  if (days.length < 2) return 1
  const gaps: number[] = []
  for (let index = 1; index < days.length; index++) {
    const gap = days[index] - days[index - 1]
    if (gap > 0) gaps.push(gap)
  }
  return median(gaps) ?? 1
}

export function seriesDays(series: { date: string }[]): number[] {
  return series.map((point) => dayNumber(point.date)).filter((day) => Number.isFinite(day))
}
