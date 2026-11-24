interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  className?: string
}

/**
 * Sparkline mínima: solo dibuja si hay 2+ puntos reales.
 * No inventa datos ni rellena huecos.
 */
export default function Sparkline({
  values,
  width = 96,
  height = 26,
  className,
}: SparklineProps) {
  const points = values.filter((v) => Number.isFinite(v))
  if (points.length < 2) return null

  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const pad = 3
  const stepX = (width - pad * 2) / (points.length - 1)

  const coords = points.map((value, index) => {
    const x = pad + index * stepX
    const y = height - pad - ((value - min) / span) * (height - pad * 2)
    return [x, y] as const
  })

  const path = coords
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ')
  const last = coords[coords.length - 1]
  const falling = points[points.length - 1] <= points[0]
  const stroke = falling ? 'var(--positive)' : 'var(--negative)'

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2" fill={stroke} />
    </svg>
  )
}
