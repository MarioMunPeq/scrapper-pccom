interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  className?: string
}

export default function Sparkline({
  values,
  width = 96,
  height = 32,
  className = '',
}: SparklineProps) {
  const clean = values.filter((value) => Number.isFinite(value)).slice(-30)
  const pad = 4
  if (clean.length === 0) {
    return <svg width={width} height={height} className={className} aria-hidden="true" />
  }

  const min = Math.min(...clean)
  const max = Math.max(...clean)
  const span = max - min
  const domainMin = span === 0 ? min - 1 : min - span * 0.1
  const domainMax = span === 0 ? max + 1 : max + span * 0.1
  const x = (index: number) =>
    clean.length === 1 ? width / 2 : pad + (index / (clean.length - 1)) * (width - pad * 2)
  const y = (value: number) =>
    height - pad - ((value - domainMin) / (domainMax - domainMin)) * (height - pad * 2)

  const trend =
    clean.length < 2
      ? 'flat'
      : clean[clean.length - 1] < clean[0]
        ? 'down'
        : clean[clean.length - 1] > clean[0]
          ? 'up'
          : 'flat'

  const points = clean.map((value, index) => `${x(index)} ${y(value)}`).join(' L ')
  const lastX = x(clean.length - 1)
  const lastY = y(clean[clean.length - 1])

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`sparkline sparkline--${trend} ${className}`.trim()}
      aria-hidden="true"
      focusable="false"
    >
      {clean.length > 1 && (
        <path
          d={`M ${points}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <circle
        cx={lastX}
        cy={lastY}
        r={clean.length === 1 ? 2 : 2.5}
        fill="currentColor"
        stroke="var(--bg)"
        strokeWidth={clean.length === 1 ? 0 : 1}
      />
    </svg>
  )
}
