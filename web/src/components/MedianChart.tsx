import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import {
  dayNumber,
  formatDate,
  formatDayMonth,
  formatPrice0,
  niceTicks,
  type GlobalPoint,
} from '../lib'

interface MedianChartProps {
  points: GlobalPoint[]
}

const PAD = { top: 18, right: 14, bottom: 26, left: 56 }
const DROPS_H = 54
const GAP = 26

export default function MedianChart({ points }: MedianChartProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const update = () => setWidth(Math.max(260, node.clientWidth))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const data = useMemo(
    () =>
      points
        .filter((point) => point.median !== null && Number.isFinite(point.median))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [points]
  )

  const height = width < 560 ? 250 : 310
  const plotW = Math.max(1, width - PAD.left - PAD.right)
  const medianH = Math.max(40, height - PAD.top - PAD.bottom - DROPS_H - GAP)

  const geometry = useMemo(() => {
    if (data.length === 0) return null
    const days = data.map((point) => dayNumber(point.date))
    let minDay = Math.min(...days)
    let maxDay = Math.max(...days)
    if (maxDay - minDay < 2) {
      minDay -= 1
      maxDay += 1
    }

    const medians = data.map((point) => point.median as number)
    let minPrice = Math.min(...medians)
    let maxPrice = Math.max(...medians)
    if (maxPrice === minPrice) {
      const pad = Math.max(25, minPrice * 0.05)
      minPrice -= pad
      maxPrice += pad
    } else {
      const pad = (maxPrice - minPrice) * 0.18
      minPrice -= pad
      maxPrice += pad
    }

    const maxDrops = Math.max(1, ...data.map((point) => point.drops))
    const x = (date: string) => PAD.left + ((dayNumber(date) - minDay) / (maxDay - minDay)) * plotW
    const y = (price: number) => PAD.top + (1 - (price - minPrice) / (maxPrice - minPrice)) * medianH
    const dropsTop = PAD.top + medianH + GAP
    const dropsY = (value: number) => dropsTop + DROPS_H - (value / maxDrops) * DROPS_H
    const barW = clampBar(plotW / Math.max(6, data.length * 1.8))

    return {
      x,
      y,
      dropsY,
      dropsTop,
      maxDrops,
      barW,
      ticks: niceTicks(minPrice, maxPrice, width < 560 ? 3 : 4),
      items: data.map((point) => ({
        ...point,
        x: x(point.date),
        y: y(point.median as number),
      })),
    }
  }, [data, plotW, medianH, width])

  function clampBar(value: number) {
    return Math.min(18, Math.max(4, value))
  }

  const handleMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!geometry) return
    const rect = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - rect.left
    let nearest = 0
    let distance = Infinity
    geometry.items.forEach((item, index) => {
      const d = Math.abs(item.x - px)
      if (d < distance) {
        distance = d
        nearest = index
      }
    })
    setHover(nearest)
  }

  const active = hover !== null && geometry ? geometry.items[hover] : null

  if (!geometry) {
    return (
      <p className="empty-note">
        Todavía no hay precios registrados para calcular la mediana diaria.
      </p>
    )
  }

  const xLabels = (() => {
    if (data.length === 1) {
      return [{ iso: data[0].date, x: geometry.items[0].x }]
    }
    const count = width < 560 ? 3 : 5
    const labels: { iso: string; x: number }[] = []
    for (let i = 0; i < count; i += 1) {
      const ratio = i / (count - 1)
      const day = dayNumber(data[0].date) + (dayNumber(data[data.length - 1].date) - dayNumber(data[0].date)) * ratio
      labels.push({
        iso: new Date(day * 86_400_000).toISOString().slice(0, 10),
        x: PAD.left + ratio * plotW,
      })
    }
    return labels
  })()

  const linePath = geometry.items
    .map((item, index) => `${index === 0 ? 'M' : 'L'}${item.x} ${item.y}`)
    .join(' ')

  return (
    <div className="chart" ref={wrapRef}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Mediana diaria del precio de los PCs monitorizados. Último valor ${formatPrice0(
          data[data.length - 1].median
        )} el ${formatDate(data[data.length - 1].date)}.`}
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(null)}
      >
        {geometry.ticks.map((tick) => {
          const y = geometry.y(tick)
          if (y < PAD.top - 1 || y > PAD.top + medianH + 1) return null
          return (
            <g key={tick}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y} y2={y} className="chart__grid" />
              <text x={PAD.left - 8} y={y + 3.5} className="chart__axis" textAnchor="end">
                {tick >= 1000 ? `${Math.round(tick / 100) / 10}k` : Math.round(tick)}
              </text>
            </g>
          )
        })}

        {data.length > 1 && (
          <path
            d={`${linePath} L${geometry.items[geometry.items.length - 1].x} ${
              PAD.top + medianH
            } L${geometry.items[0].x} ${PAD.top + medianH} Z`}
            className="chart__area"
          />
        )}
        {data.length > 1 && <path d={linePath} className="chart__line" />}

        {geometry.items.map((item, index) => {
          const isLast = index === geometry.items.length - 1
          const isActive = index === hover
          if (geometry.items.length > 60 && !isLast && !isActive) return null
          return (
            <circle
              key={item.date}
              cx={item.x}
              cy={item.y}
              r={isActive ? 4.5 : isLast ? 4 : 2.4}
              className={isLast || isActive ? 'chart__dot is-strong' : 'chart__dot'}
            />
          )
        })}

        {/* Panel de bajadas */}
        <text x={PAD.left} y={geometry.dropsTop - 9} className="chart__subhead">
          PCs que bajan de precio
        </text>
        <line
          x1={PAD.left}
          x2={PAD.left + plotW}
          y1={geometry.dropsTop + DROPS_H}
          y2={geometry.dropsTop + DROPS_H}
          className="chart__grid"
        />
        <text
          x={PAD.left - 8}
          y={geometry.dropsTop + 8}
          className="chart__axis"
          textAnchor="end"
        >
          {geometry.maxDrops}
        </text>
        <text
          x={PAD.left - 8}
          y={geometry.dropsTop + DROPS_H}
          className="chart__axis"
          textAnchor="end"
        >
          0
        </text>
        {geometry.items.map((item) => (
          <rect
            key={`drop-${item.date}`}
            x={item.x - geometry.barW / 2}
            y={geometry.dropsY(item.drops)}
            width={geometry.barW}
            height={Math.max(0, geometry.dropsTop + DROPS_H - geometry.dropsY(item.drops))}
            rx={1}
            className={item.drops > 0 ? 'chart__bar' : 'chart__bar is-zero'}
          />
        ))}

        {xLabels.map((label, index) => (
          <text
            key={`${label.iso}-${index}`}
            x={label.x}
            y={height - 6}
            className="chart__axis"
            textAnchor={index === 0 ? 'start' : index === xLabels.length - 1 ? 'end' : 'middle'}
          >
            {formatDayMonth(label.iso)}
          </text>
        ))}

        {active && (
          <line
            x1={active.x}
            x2={active.x}
            y1={PAD.top}
            y2={geometry.dropsTop + DROPS_H}
            className="chart__cursor"
          />
        )}
      </svg>

      {active && (
        <div
          className="chart__tooltip"
          style={{
            left: Math.min(Math.max(active.x, 78), width - 78),
            top: Math.max(6, active.y - 64),
          }}
        >
          <span className="chart__tooltip-date">{formatDate(active.date)}</span>
          <strong className="chart__tooltip-price">{formatPrice0(active.median)}</strong>
          <span className="chart__tooltip-delta">
            {active.drops} {active.drops === 1 ? 'PC baja' : 'PCs bajan'} · {active.count} con datos
          </span>
        </div>
      )}

      {data.length === 1 && (
        <p className="chart__single">
          Solo hay un día de datos. La evolución diaria empezará a dibujarse con el próximo scrape.
        </p>
      )}
    </div>
  )
}
