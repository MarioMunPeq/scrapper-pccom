import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import {
  clamp,
  dayNumber,
  formatDate,
  formatDayMonth,
  formatPrice,
  formatSignedPrice,
  niceTicks,
} from '../lib'

type Range = '7d' | '30d' | 'all'

interface PriceChartProps {
  series: [string, number][]
  pvpr: number | null
  productName: string
}

interface Marker {
  date: string
  short: string
  label: string
}

/** Hitos comerciales del periodo visible (año de la serie). */
function buildMarkers(year: number): Marker[] {
  const next = year + 1
  return [
    { date: `${year}-11-27`, short: '27/11', label: 'Black Friday' },
    { date: `${year}-11-30`, short: '30/11', label: 'Cyber Monday' },
    { date: `${year}-12-25`, short: '25/12', label: 'Navidad' },
    { date: `${next}-01-06`, short: '6/1', label: 'Reyes' },
    { date: `${next}-01-07`, short: '7/1', label: 'Rebajas de enero' },
  ]
}

const PAD = { top: 34, right: 16, bottom: 28, left: 52 }

export default function PriceChart({ series, pvpr, productName }: PriceChartProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(720)
  const [range, setRange] = useState<Range>('30d')
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

  const sorted = useMemo(
    () =>
      [...series]
        .filter((entry) => Array.isArray(entry) && entry.length >= 2 && Number.isFinite(Number(entry[1])))
        .map((entry) => [String(entry[0]).slice(0, 10), Number(entry[1])] as [string, number])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    [series]
  )

  const visible = useMemo(() => {
    if (sorted.length === 0) return sorted
    if (range === 'all') return sorted
    const lastDay = dayNumber(sorted[sorted.length - 1][0])
    const windowDays = range === '7d' ? 7 : 30
    return sorted.filter((entry) => dayNumber(entry[0]) > lastDay - windowDays)
  }, [sorted, range])

  const height = width < 560 ? 236 : 300
  const plotW = Math.max(1, width - PAD.left - PAD.right)
  const plotH = Math.max(1, height - PAD.top - PAD.bottom)

  const geometry = useMemo(() => {
    if (visible.length === 0) return null

    const days = visible.map((entry) => dayNumber(entry[0]))
    let minDay = Math.min(...days)
    let maxDay = Math.max(...days)
    if (maxDay - minDay < 2) {
      minDay -= 1
      maxDay += 1
    }

    const prices = visible.map((entry) => entry[1])
    let minPrice = Math.min(...prices)
    let maxPrice = Math.max(...prices)
    if (pvpr !== null && pvpr > 0) {
      minPrice = Math.min(minPrice, pvpr)
      maxPrice = Math.max(maxPrice, pvpr)
    }
    if (maxPrice === minPrice) {
      const pad = Math.max(20, minPrice * 0.04)
      minPrice -= pad
      maxPrice += pad
    } else {
      const pad = (maxPrice - minPrice) * 0.12
      minPrice -= pad
      maxPrice += pad
    }

    const x = (date: string) => PAD.left + ((dayNumber(date) - minDay) / (maxDay - minDay)) * plotW
    const y = (price: number) => PAD.top + (1 - (price - minPrice) / (maxPrice - minPrice)) * plotH

    const points = visible.map(([date, price]) => ({ date, price, x: x(date), y: y(price) }))
    const ticks = niceTicks(minPrice, maxPrice, width < 560 ? 3 : 4)
    const firstYear = Number(visible[visible.length - 1][0].slice(0, 4))
    const markers = buildMarkers(firstYear).filter((marker) => {
      const day = dayNumber(marker.date)
      return day >= minDay && day <= maxDay
    })

    return { points, x, y, minDay, maxDay, ticks, markers }
  }, [visible, pvpr, plotW, plotH, width])

  const active = hover !== null && geometry ? geometry.points[hover] : null
  const previous = hover !== null && hover > 0 && geometry ? geometry.points[hover - 1] : null

  const handleMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!geometry) return
    const rect = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - rect.left
    let nearest = 0
    let distance = Infinity
    geometry.points.forEach((point, index) => {
      const d = Math.abs(point.x - px)
      if (d < distance) {
        distance = d
        nearest = index
      }
    })
    setHover(nearest)
  }

  const rangeButtons: { key: Range; label: string }[] = [
    { key: '7d', label: '7 días' },
    { key: '30d', label: '30 días' },
    { key: 'all', label: 'Todo' },
  ]

  const summary = useMemo(() => {
    if (sorted.length === 0) return 'Sin historial de precios disponible.'
    if (sorted.length === 1) {
      return `Un único registro de precio, ${formatPrice(sorted[0][1])}, el ${formatDate(sorted[0][0])}.`
    }
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    return `Evolución de precio de ${productName}: ${formatPrice(first[1])} el ${formatDate(
      first[0]
    )} y ${formatPrice(last[1])} el ${formatDate(last[0])}. ${sorted.length} días con datos.`
  }, [sorted, productName])

  return (
    <div className="chart">
      <div className="chart__head">
        <div className="chart__legend">
          <span className="chart__legend-item">
            <span className="chart__swatch chart__swatch--line" /> Precio
          </span>
          {pvpr !== null && (
            <span className="chart__legend-item">
              <span className="chart__swatch chart__swatch--pvpr" /> PVPR
            </span>
          )}
        </div>
        <div className="segmented" role="group" aria-label="Rango del gráfico">
          {rangeButtons.map((button) => (
            <button
              key={button.key}
              type="button"
              className={`segmented__btn${range === button.key ? ' is-active' : ''}`}
              aria-pressed={range === button.key}
              onClick={() => {
                setRange(button.key)
                setHover(null)
              }}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart__plot" ref={wrapRef}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={summary}
          onPointerMove={handleMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* Rejilla + eje Y */}
          {geometry?.ticks.map((tick) => {
            const y = geometry.y(tick)
            if (y < PAD.top - 1 || y > PAD.top + plotH + 1) return null
            return (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotW}
                  y1={y}
                  y2={y}
                  className="chart__grid"
                />
                <text x={PAD.left - 8} y={y + 3.5} className="chart__axis" textAnchor="end">
                  {tick >= 1000 ? `${Math.round(tick / 100) / 10}k` : Math.round(tick)}
                </text>
              </g>
            )
          })}

          {/* Eje X: 4 fechas repartidas */}
          {geometry &&
            (() => {
              const count = width < 560 ? 3 : 5
              const labels: { iso: string; x: number }[] = []
              for (let i = 0; i < count; i += 1) {
                const ratio = i / (count - 1)
                const day = geometry.minDay + (geometry.maxDay - geometry.minDay) * ratio
                const iso = new Date(day * 86_400_000).toISOString().slice(0, 10)
                labels.push({ iso, x: PAD.left + ratio * plotW })
              }
              return labels.map((label, index) => (
                <text
                  key={`${label.iso}-${index}`}
                  x={clamp(label.x, PAD.left, PAD.left + plotW)}
                  y={height - 8}
                  className="chart__axis"
                  textAnchor={index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'}
                >
                  {formatDayMonth(label.iso)}
                </text>
              ))
            })()}

          {/* Hitos */}
          {geometry?.markers.map((marker, index) => {
            const x = geometry.x(marker.date)
            return (
              <g key={marker.label}>
                <line
                  x1={x}
                  x2={x}
                  y1={PAD.top - 6}
                  y2={PAD.top + plotH}
                  className="chart__marker"
                />
                <text
                  x={x}
                  y={index % 2 === 0 ? PAD.top - 16 : PAD.top - 4}
                  className="chart__marker-label"
                  textAnchor="middle"
                >
                  {marker.short}
                </text>
              </g>
            )
          })}

          {/* PVPR */}
          {geometry && pvpr !== null && (
            <g>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={geometry.y(pvpr)}
                y2={geometry.y(pvpr)}
                className="chart__pvpr"
              />
              <text
                x={PAD.left + plotW}
                y={geometry.y(pvpr) - 5}
                className="chart__pvpr-label"
                textAnchor="end"
              >
                PVPR {formatPrice(pvpr)}
              </text>
            </g>
          )}

          {/* Área + línea */}
          {geometry && geometry.points.length > 1 && (
            <>
              <path
                d={`${geometry.points
                  .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
                  .join(' ')} L${geometry.points[geometry.points.length - 1].x} ${
                  PAD.top + plotH
                } L${geometry.points[0].x} ${PAD.top + plotH} Z`}
                className="chart__area"
              />
              <path
                d={geometry.points
                  .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
                  .join(' ')}
                className="chart__line"
              />
            </>
          )}

          {/* Puntos */}
          {geometry?.points.map((point, index) => {
            const isLast = index === geometry.points.length - 1
            const isActive = index === hover
            if (geometry.points.length > 60 && !isLast && !isActive) return null
            return (
              <circle
                key={point.date}
                cx={point.x}
                cy={point.y}
                r={isActive ? 4.5 : isLast ? 4 : 2.4}
                className={isLast || isActive ? 'chart__dot is-strong' : 'chart__dot'}
              />
            )
          })}

          {/* Guía vertical al pasar el ratón */}
          {active && (
            <line
              x1={active.x}
              x2={active.x}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="chart__cursor"
            />
          )}
        </svg>

        {active && (
          <div
            className="chart__tooltip"
            style={{
              left: clamp(active.x, 70, width - 70),
              top: clamp(active.y - 12, 8, height - 64),
            }}
          >
            <span className="chart__tooltip-date">{formatDate(active.date)}</span>
            <strong className="chart__tooltip-price">{formatPrice(active.price)}</strong>
            {previous && (
              <span
                className={`chart__tooltip-delta ${
                  active.price < previous.price ? 'is-down' : active.price > previous.price ? 'is-up' : ''
                }`}
              >
                {formatSignedPrice(active.price - previous.price)} vs anterior
              </span>
            )}
          </div>
        )}

        {visible.length === 1 && (
          <p className="chart__single">Un único día registrado todavía. La línea aparecerá con el próximo scrape.</p>
        )}
      </div>

      {geometry && geometry.markers.length > 0 && (
        <ul className="chart__hitos" aria-label="Hitos del periodo">
          {geometry.markers.map((marker) => (
            <li key={marker.label}>
              <span className="chart__hito-date">{marker.short}</span>
              {marker.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
