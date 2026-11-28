import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import {
  dayNumber,
  formatDayMonth,
  formatFullDate,
  formatPct,
  formatPrice,
  formatPrice2,
  isoFromDay,
} from '../lib/format'
import { buildAxis, buildTimeTicks, medianInterval } from '../lib/scale'
import { prefersReducedMotion } from '../lib/motion'

export interface PricePoint {
  date: string
  value: number
}

export interface PriceChartBar {
  date: string
  value: number
}

export interface PriceChartMilestone {
  date: string
  label: string
}

interface PriceChartProps {
  points: PricePoint[] | [string, number][]
  pvpr?: number | null
  bars?: PriceChartBar[]
  milestones?: PriceChartMilestone[]
  height?: number
  chartLabel?: string
  emptyLabel?: string
}

interface HoverState {
  index: number
  x: number
  y: number
  milestone: string | null
}

function useElementWidth<T extends HTMLElement>(ref: RefObject<T | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (value: number) => setWidth((current) => (Math.abs(current - value) > 0.5 ? value : current))
    update(element.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) update(entries[0].contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return width
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)')
    const update = () => setMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return mobile
}

function normalizePoints(input: PricePoint[] | [string, number][]): PricePoint[] {
  const list: PricePoint[] = []
  for (const entry of input) {
    const date = Array.isArray(entry) ? String(entry[0]) : entry.date
    const value = Array.isArray(entry) ? Number(entry[1]) : Number(entry.value)
    if (!date || !Number.isFinite(value)) continue
    list.push({ date: date.slice(0, 10), value })
  }
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const byDate = new Map<string, PricePoint>()
  for (const point of list) byDate.set(point.date, point)
  return [...byDate.values()]
}

function linePath(points: { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
}

function areaPath(points: { x: number; y: number }[], baseline: number): string {
  if (points.length < 2) return ''
  const head = points[0]
  const tail = points[points.length - 1]
  return `${linePath(points)} L${tail.x.toFixed(2)} ${baseline.toFixed(2)} L${head.x.toFixed(2)} ${baseline.toFixed(2)} Z`
}

export default function PriceChart({
  points,
  pvpr = null,
  bars = [],
  milestones = [],
  height = 320,
  chartLabel = 'Evolución del precio',
  emptyLabel = 'Sin datos de precio todavía',
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const width = useElementWidth(containerRef)
  const isMobile = useIsMobile()
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const areaId = `chart-area-${rawId}`
  const hatchId = `chart-hatch-${rawId}`
  const [drawn, setDrawn] = useState(false)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [active, setActive] = useState<number | null>(null)

  const series = useMemo(() => normalizePoints(points), [points])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    if (prefersReducedMotion()) {
      setDrawn(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setDrawn(true)
          observer.disconnect()
        }
      },
      { threshold: 0.3 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(() => {
    const margin = isMobile
      ? { top: 24, right: 12, bottom: 36, left: 48 }
      : { top: 24, right: 24, bottom: 36, left: 64 }
    const innerW = Math.max(10, width - margin.left - margin.right)
    const innerH = Math.max(40, height - margin.top - margin.bottom)

    if (!series.length) {
      const emptyAxis = buildAxis([])
      return {
        margin,
        innerW,
        innerH,
        left: margin.left,
        right: margin.left + innerW,
        top: margin.top,
        bottom: margin.top + innerH,
        x: () => margin.left,
        y: () => margin.top,
        plotted: [],
        solidRuns: [],
        dashedRuns: [],
        yTicks: [],
        xTicks: [],
        futureRect: null,
        domainStart: 0,
        domainEnd: 1,
        dataEnd: 0,
        single: false,
        milestoneLayout: [],
        barLayout: [],
        barMax: 0,
        axis: emptyAxis,
      }
    }

    const days = series.map((point) => dayNumber(point.date)).filter((day) => Number.isFinite(day))
    const dataStart = days[0]
    const dataEnd = days[days.length - 1]
    const dataSpan = dataEnd - dataStart
    const single = series.length === 1
    const future = !single && dataSpan < 30
    const domainStart = single ? dataStart - 1 : dataStart
    const domainEnd = single ? dataStart + 1 : future ? dataEnd + 14 : dataEnd
    const span = Math.max(1, domainEnd - domainStart)

    const values = series.map((point) => point.value)
    if (pvpr !== null && Number.isFinite(pvpr) && pvpr > 0) values.push(pvpr)
    const axis = buildAxis(values)

    const x = (day: number) => margin.left + ((day - domainStart) / span) * innerW
    const y = (value: number) => margin.top + (1 - (value - axis.min) / (axis.max - axis.min || 1)) * innerH

    const plotted = series.map((point) => ({
      ...point,
      day: dayNumber(point.date),
      x: x(dayNumber(point.date)),
      y: y(point.value),
    }))

    const gaps = plotted.slice(1).map((point, index) => {
      const previous = plotted[index]
      const gap = point.day - previous.day
      const typical = medianInterval(plotted.map((p) => p.day))
      return gap > typical * 1.5 && gap > 1
    })

    const solidRuns: { x: number; y: number }[][] = []
    const dashedRuns: { x: number; y: number }[][] = []
    let run: { x: number; y: number }[] = plotted.length ? [{ x: plotted[0].x, y: plotted[0].y }] : []
    for (let index = 1; index < plotted.length; index++) {
      if (gaps[index - 1]) {
        if (run.length > 1) solidRuns.push(run)
        dashedRuns.push([
          { x: plotted[index - 1].x, y: plotted[index - 1].y },
          { x: plotted[index].x, y: plotted[index].y },
        ])
        run = [{ x: plotted[index].x, y: plotted[index].y }]
      } else {
        run.push({ x: plotted[index].x, y: plotted[index].y })
      }
    }
    if (run.length > 1) solidRuns.push(run)

    const yTicks = axis.ticks.map((tick) => ({ value: tick, y: y(tick) }))
    const xTicks = buildTimeTicks(Math.round(domainStart), Math.round(domainEnd)).map((day) => ({
      day,
      x: x(day),
      label: formatDayMonth(isoFromDay(day)),
      future: day > dataEnd + 0.001,
    }))

    const futureRect =
      future && dataEnd < domainEnd
        ? { x: x(dataEnd), y: margin.top, width: x(domainEnd) - x(dataEnd), height: innerH }
        : null

    const milestoneLayout: { x: number; y: number; label: string; width: number }[] = []
    let lastRight = -Infinity
    for (const milestone of milestones) {
      const day = dayNumber(milestone.date)
      if (!Number.isFinite(day) || day < domainStart || day > domainEnd) continue
      const px = x(day)
      const labelWidth = Math.max(56, milestone.label.length * 6 + 16)
      let labelY = margin.top + 2
      if (px - labelWidth / 2 < lastRight + 80) labelY += 24
      lastRight = px + labelWidth / 2
      milestoneLayout.push({ x: px, y: labelY, label: milestone.label, width: labelWidth })
    }

    const barMax = bars.reduce((max, bar) => Math.max(max, bar.value), 0)
    const barZone = bars.length ? 56 : 0
    const barLayout = bars
      .map((bar) => {
        const day = dayNumber(bar.date)
        if (!Number.isFinite(day) || day < domainStart || day > domainEnd) return null
        const ratio = barMax > 0 ? bar.value / barMax : 0
        const barHeight = Math.max(2, ratio * (barZone - 12))
        return {
          date: bar.date,
          value: bar.value,
          x: x(day),
          y: margin.top + innerH - barHeight,
          height: barHeight,
        }
      })
      .filter((bar): bar is NonNullable<typeof bar> => bar !== null)

    return {
      margin,
      innerW,
      innerH,
      left: margin.left,
      right: margin.left + innerW,
      top: margin.top,
      bottom: margin.top + innerH,
      x,
      y,
      plotted,
      solidRuns,
      dashedRuns,
      yTicks,
      xTicks,
      futureRect,
      domainStart,
      domainEnd,
      dataEnd,
      single,
      milestoneLayout,
      barLayout,
      barMax,
      axis,
    }
  }, [series, width, height, isMobile, pvpr, bars, milestones])

  const hasLayout = 'plotted' in layout

  const hoverFromPointer = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg || !hasLayout || !series.length) return
    const rect = svg.getBoundingClientRect()
    const px = Math.min(Math.max(clientX - rect.left, layout.left), layout.right)
    const py = clientY - rect.top
    const ratio = (px - layout.left) / Math.max(1, layout.innerW)
    const day = layout.domainStart + ratio * (layout.domainEnd - layout.domainStart)
    let bestIndex = 0
    let bestDistance = Infinity
    layout.plotted.forEach((point, index) => {
      const distance = Math.abs(point.day - day)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    })
    const nearest = layout.plotted[bestIndex]
    let milestone: string | null = null
    let milestoneDistance = Infinity
    for (const marker of layout.milestoneLayout) {
      const distance = Math.abs(marker.x - px)
      if (distance < milestoneDistance && distance < 16) {
        milestoneDistance = distance
        milestone = marker.label
      }
    }
    setHover({ index: bestIndex, x: nearest.x, y: Math.min(Math.max(py, layout.top), layout.bottom), milestone })
    setActive(bestIndex)
  }

  const clearHover = () => {
    setHover(null)
    setActive(null)
  }

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!hasLayout || !layout.plotted.length) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const current = active ?? layout.plotted.length - 1
    const next = Math.min(
      layout.plotted.length - 1,
      Math.max(0, current + (event.key === 'ArrowRight' ? 1 : -1))
    )
    const point = layout.plotted[next]
    setActive(next)
    setHover({ index: next, x: point.x, y: point.y, milestone: null })
  }

  const svgHeight = Math.max(120, height)
  const activePoint = hover && hasLayout ? layout.plotted[hover.index] : null
  const activePrevious =
    activePoint && hasLayout && hover && hover.index > 0 ? layout.plotted[hover.index - 1] : null
  const activeBar =
    activePoint && hasLayout
      ? layout.barLayout.find((bar) => bar.date === activePoint.date) ?? null
      : null
  const ariaSummary = useMemo(() => {
    if (!series.length) return emptyLabel
    const values = series.map((point) => point.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const first = series[0]
    const last = series[series.length - 1]
    const delta = first.value !== 0 ? ((last.value - first.value) / first.value) * 100 : 0
    return `${chartLabel}. ${formatDayMonth(first.date)} a ${formatDayMonth(
      last.date
    )}. Entre ${formatPrice(min)} y ${formatPrice(max)}. Variación ${formatPct(delta)}.`
  }, [series, chartLabel, emptyLabel])

  const liveText =
    activePoint && hasLayout
      ? `${formatFullDate(activePoint.date)}: ${formatPrice2(activePoint.value)}${
          activePrevious
            ? `, variación ${formatPct(
                ((activePoint.value - activePrevious.value) / activePrevious.value) * 100
              )}`
            : ''
        }`
      : ''

  if (!width) {
    return <div ref={containerRef} className="chart" style={{ height: svgHeight }} aria-hidden="true" />
  }

  return (
    <div ref={containerRef} className="chart" style={{ height: svgHeight }}>
      <svg
        ref={svgRef}
        className="chart__svg"
        width={width}
        height={svgHeight}
        viewBox={`0 0 ${width} ${svgHeight}`}
        role="img"
        aria-label={ariaSummary}
        tabIndex={0}
        onPointerMove={(event) => hoverFromPointer(event.clientX, event.clientY)}
        onPointerDown={(event) => {
          hoverFromPointer(event.clientX, event.clientY)
        }}
        onPointerLeave={clearHover}
        onPointerCancel={clearHover}
        onKeyDown={onKeyDown}
        onBlur={clearHover}
      >
        <defs>
          <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <pattern id={hatchId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" className="chart__hatch" />
          </pattern>
        </defs>

        {hasLayout && (
          <>
            {layout.futureRect && layout.futureRect.width > 0 && (
              <>
                <rect
                  x={layout.futureRect.x}
                  y={layout.futureRect.y}
                  width={layout.futureRect.width}
                  height={layout.futureRect.height}
                  className="chart__future"
                />
                <rect
                  x={layout.futureRect.x}
                  y={layout.futureRect.y}
                  width={layout.futureRect.width}
                  height={layout.futureRect.height}
                  fill={`url(#${hatchId})`}
                />
                <text
                  x={layout.futureRect.x + 8}
                  y={layout.futureRect.y + 48}
                  className="chart__future-label"
                  data-micro="true"
                >
                  SIN DATOS AÚN
                </text>
              </>
            )}

            {layout.milestoneLayout.map((marker) => (
              <g key={`${marker.label}-${marker.x}`}>
                <line
                  x1={marker.x}
                  x2={marker.x}
                  y1={layout.top}
                  y2={layout.bottom}
                  className="chart__milestone"
                />
                {isMobile ? (
                  <circle cx={marker.x} cy={layout.top + 4} r="3" className="chart__milestone-dot" />
                ) : (
                  <>
                    <rect
                      x={marker.x - marker.width / 2}
                      y={marker.y - 12}
                      width={marker.width}
                      height="20"
                      rx="6"
                      className="chart__milestone-label-bg"
                    />
                    <text
                      x={marker.x}
                      y={marker.y + 2}
                      textAnchor="middle"
                      className="chart__milestone-label"
                      data-micro="true"
                    >
                      {marker.label}
                    </text>
                  </>
                )}
              </g>
            ))}

            {layout.yTicks.map((tick) => (
              <g key={`y-${tick.value}`}>
                <line x1={layout.left} x2={layout.right} y1={tick.y} y2={tick.y} className="chart__grid-line" />
                <text
                  x={layout.left - 12}
                  y={tick.y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="chart__axis-text"
                  data-axis="y"
                >
                  {formatPrice(tick.value)}
                </text>
              </g>
            ))}

            <line
              x1={layout.left}
              x2={layout.right}
              y1={layout.bottom}
              y2={layout.bottom}
              className="chart__axis-line"
            />

            {layout.xTicks.map((tick) => (
              <text
                key={`x-${tick.day}`}
                x={tick.x}
                y={layout.bottom + 20}
                textAnchor="middle"
                className={`chart__axis-text${tick.future ? ' chart__axis-text--future' : ''}`}
                data-axis="x"
              >
                {tick.label}
              </text>
            ))}

            {layout.barLayout.map((bar) => (
              <rect
                key={`bar-${bar.date}`}
                x={bar.x - 4}
                y={bar.y}
                width="8"
                height={bar.height}
                rx="2"
                className="chart__bar"
              />
            ))}

            {layout.solidRuns.map((run, index) => (
              <g key={`area-${index}`}>
                <path
                  d={areaPath(run, layout.bottom)}
                  fill={`url(#${areaId})`}
                  className="chart__area"
                  style={{ opacity: drawn ? 1 : 0 }}
                />
                <path
                  d={linePath(run)}
                  pathLength={1}
                  className="chart__line"
                  style={{ strokeDasharray: 1, strokeDashoffset: drawn ? 0 : 1 }}
                />
              </g>
            ))}

            {layout.dashedRuns.map((run, index) => (
              <path key={`gap-${index}`} d={linePath(run)} className="chart__line chart__line--gap" />
            ))}

            {layout.plotted.length <= 60 &&
              layout.plotted.map((point) => (
                <circle
                  key={`dot-${point.date}`}
                  cx={point.x}
                  cy={point.y}
                  r="3.5"
                  className="chart__dot"
                />
              ))}

            {layout.single && (
              <text
                x={(layout.left + layout.right) / 2}
                y={layout.top + layout.innerH / 2 + 24}
                textAnchor="middle"
                className="chart__empty-note"
              >
                Historial en construcción · 1 día
              </text>
            )}

            {!layout.single && pvpr !== null && Number.isFinite(pvpr) && pvpr > 0 && (
              <g>
                <line
                  x1={layout.left}
                  x2={layout.right}
                  y1={layout.y(pvpr)}
                  y2={layout.y(pvpr)}
                  className="chart__pvpr"
                />
                <text
                  x={layout.right}
                  y={layout.y(pvpr) - 6}
                  textAnchor="end"
                  className="chart__pvpr-label"
                >
                  PVPR {formatPrice(pvpr)}
                </text>
              </g>
            )}

            {hover && activePoint && (
              <>
                <line
                  x1={hover.x}
                  x2={hover.x}
                  y1={layout.top}
                  y2={layout.bottom}
                  className="chart__crosshair"
                />
                <circle cx={activePoint.x} cy={activePoint.y} r="5" className="chart__hover-dot" />
              </>
            )}
          </>
        )}

        {!hasLayout && series.length <= 1 && (
          <text x={width / 2} y={svgHeight / 2} textAnchor="middle" className="chart__empty-note">
            {emptyLabel}
          </text>
        )}
      </svg>

      {hover && activePoint && (
        <div
          className="chart-tooltip"
          style={{
            left: hover.x,
            transform:
              hover.x < 100
                ? 'translateX(0)'
                : hover.x > width - 100
                  ? 'translateX(-100%)'
                  : 'translateX(-50%)',
          }}
        >
          <div className="chart-tooltip__date">{formatFullDate(activePoint.date)}</div>
          <div className="chart-tooltip__price">{formatPrice2(activePoint.value)}</div>
          {activePrevious && (
            <div className="chart-tooltip__row">
              <span>vs. anterior</span>
              <strong
                className={
                  activePoint.value < activePrevious.value
                    ? 'is-down'
                    : activePoint.value > activePrevious.value
                      ? 'is-up'
                      : 'is-flat'
                }
              >
                {formatPct(((activePoint.value - activePrevious.value) / activePrevious.value) * 100)}
              </strong>
            </div>
          )}
          {pvpr !== null && Number.isFinite(pvpr) && pvpr > 0 && (
            <div className="chart-tooltip__row">
              <span>PVPR</span>
              <strong>{formatPrice(pvpr)}</strong>
            </div>
          )}
          {activeBar && (
            <div className="chart-tooltip__row">
              <span>PCs que bajan</span>
              <strong className="is-down">{activeBar.value}</strong>
            </div>
          )}
          {hover.milestone && <div className="chart-tooltip__hito">{hover.milestone}</div>}
        </div>
      )}

      <p className="visually-hidden" aria-live="polite">
        {liveText}
      </p>
    </div>
  )
}
