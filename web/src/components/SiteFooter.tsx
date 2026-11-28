import { formatDateTime } from '../lib/format'

interface SiteFooterProps {
  lastUpdated: string | null
}

export default function SiteFooter({ lastUpdated }: SiteFooterProps) {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <p className="site-footer__left">
          <span className="site-footer__brand">tracker/5070</span> · Datos recogidos de
          PcComponentes. Proyecto independiente, sin afiliación.
        </p>
        <p className="site-footer__updated">
          Última actualización {lastUpdated ? formatDateTime(lastUpdated) : '—'}
        </p>
      </div>
    </footer>
  )
}
