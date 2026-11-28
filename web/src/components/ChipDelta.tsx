import { formatPctAbs, formatSignedPrice } from '../lib/format'

interface ChipDeltaProps {
  pct: number | null | undefined
  abs?: number | null
  title?: string
  className?: string
}

export default function ChipDelta({ pct, abs, title, className = '' }: ChipDeltaProps) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null
  const direction = pct < 0 ? 'down' : pct > 0 ? 'up' : 'flat'
  const glyph = direction === 'down' ? '▼' : direction === 'up' ? '▲' : '—'
  const computedTitle =
    title ??
    (abs !== null && abs !== undefined && Number.isFinite(abs)
      ? `${formatSignedPrice(abs, 2)} (${formatPctAbs(pct)})`
      : formatPctAbs(pct))
  return (
    <span
      className={`chip-delta chip-delta--${direction} ${className}`.trim()}
      title={computedTitle}
    >
      <span className="chip-delta__glyph" aria-hidden="true" data-micro="true">
        {glyph}
      </span>
      {formatPctAbs(pct)}
    </span>
  )
}
