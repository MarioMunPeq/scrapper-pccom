import { dayNumber, formatDate } from '../lib/format'

interface StaleStripProps {
  lastScrape: string | null
}

export default function StaleStrip({ lastScrape }: StaleStripProps) {
  if (!lastScrape) return null
  const last = dayNumber(lastScrape)
  const today = dayNumber(new Date().toISOString().slice(0, 10))
  if (!Number.isFinite(last) || !Number.isFinite(today)) return null
  const days = Math.round(today - last)
  if (days <= 2) return null
  return (
    <div className="stale-strip" role="status">
      Datos de hace {days} {days === 1 ? 'día' : 'días'} · último scrape {formatDate(lastScrape).slice(0, 5)}
    </div>
  )
}
