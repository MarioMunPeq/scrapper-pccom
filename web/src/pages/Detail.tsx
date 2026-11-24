import PriceChart from '../components/PriceChart'
import {
  formatDate,
  formatDateTime,
  formatPct,
  formatPrice,
  formatPrice0,
  formatSignedPrice,
  type Product,
} from '../lib'

interface DetailProps {
  product: Product | null
  series: [string, number][]
  loading: boolean
  isFavorite: boolean
  onToggleFavorite: (sku: string) => void
  onBack: () => void
}

interface HistoryRow {
  date: string
  price: number
  delta: number | null
  pct: number | null
}

function buildRows(series: [string, number][]): HistoryRow[] {
  const clean = [...series]
    .filter((entry) => Array.isArray(entry) && Number.isFinite(Number(entry[1])))
    .map((entry) => [String(entry[0]).slice(0, 10), Number(entry[1])] as [string, number])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  const rows = clean.map(([date, price], index) => {
    if (index === 0) return { date, price, delta: null, pct: null }
    const previous = clean[index - 1][1]
    const delta = price - previous
    return {
      date,
      price,
      delta,
      pct: previous > 0 ? (delta / previous) * 100 : null,
    }
  })

  return rows.reverse()
}

export default function Detail({
  product,
  series,
  loading,
  isFavorite,
  onToggleFavorite,
  onBack,
}: DetailProps) {
  if (!product) {
    return (
      <div className="page">
        <div className="empty empty--detail">
          <h1>{loading ? 'Cargando ficha…' : 'Producto no encontrado'}</h1>
          <p>
            {loading
              ? 'Leyendo el catálogo y el histórico de precios.'
              : 'El SKU de la URL no está en el catálogo actual. Puede que el producto ya no se venda.'}
          </p>
          <button type="button" className="btn btn--primary" onClick={onBack}>
            Volver al listado
          </button>
        </div>
      </div>
    )
  }

  const rows = buildRows(series)
  const days = product.numDiasHistorial
  const firstDate = rows.length > 0 ? rows[rows.length - 1].date : null
  const hasDiscount = product.discountPvpr !== null && product.discountPvpr > 0
  const atMin =
    product.numDiasHistorial >= 2 &&
    product.currentPrice !== null &&
    product.minPriceHistorico !== null &&
    product.currentPrice <= product.minPriceHistorico + 0.005

  return (
    <div className="page page--detail">
      <button type="button" className="back" onClick={onBack}>
        <span aria-hidden="true">←</span> Volver al listado
      </button>

      <header className="detail-head">
        <div className="detail-head__main">
          <p className="eyebrow">
            <span className="dot" aria-hidden="true" />
            {product.attributes.marca || 'PC de sobremesa'}
            <span className="eyebrow__sep">/</span>
            SKU {product.sku}
          </p>
          <h1>{product.name}</h1>

          <ul className="specs">
            <li>
              <span>CPU</span>
              <strong>{product.attributes.cpu || 'n/d'}</strong>
            </li>
            <li>
              <span>RAM</span>
              <strong>{product.attributes.ram || 'n/d'}</strong>
            </li>
            <li>
              <span>SSD</span>
              <strong>{product.attributes.ssd || 'n/d'}</strong>
            </li>
            <li>
              <span>Marca</span>
              <strong>{product.attributes.marca || 'n/d'}</strong>
            </li>
          </ul>

          <div className="detail-head__actions">
            <a
              className="btn btn--primary"
              href={product.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver en PcComponentes
              <span aria-hidden="true"> ↗</span>
            </a>
            <button
              type="button"
              className={`btn btn--ghost${isFavorite ? ' is-on' : ''}`}
              aria-pressed={isFavorite}
              onClick={() => onToggleFavorite(product.sku)}
            >
              {isFavorite ? '★ En favoritos' : '☆ Guardar en favoritos'}
            </button>
          </div>
        </div>

        <div className="price-box">
          <div className="price-box__row">
            <span className="price-box__label">Precio actual</span>
            {atMin && <span className="badge badge--min">Mín. histórico</span>}
          </div>
          <strong className="price-box__value">{formatPrice(product.currentPrice)}</strong>
          {product.pvpr !== null && (
            <p className="price-box__pvpr">
              <s>{formatPrice(product.pvpr)}</s>
              {hasDiscount && (
                <span className="price-box__discount">−{formatPct(product.discountPvpr)} vs PVPR</span>
              )}
            </p>
          )}
          {!hasDiscount && product.pvpr === null && (
            <p className="price-box__pvpr price-box__pvpr--muted">Sin PVPR tachado en la ficha</p>
          )}

          <dl className="price-box__stats">
            <div>
              <dt>Mínimo histórico</dt>
              <dd>{formatPrice0(product.minPriceHistorico)}</dd>
            </div>
            <div>
              <dt>Máximo histórico</dt>
              <dd>{formatPrice0(product.maxPriceHistorico)}</dd>
            </div>
            <div>
              <dt>Disponibilidad</dt>
              <dd className="price-box__availability">{product.availability || 'Sin datos'}</dd>
            </div>
            <div>
              <dt>Último dato</dt>
              <dd>{formatDateTime(product.lastUpdated)}</dd>
            </div>
          </dl>
        </div>
      </header>

      {days < 2 && (
        <p className="history-note" role="status">
          <strong>Historial en construcción:</strong> {days} {days === 1 ? 'día' : 'días'} de
          datos{firstDate ? `, desde el ${formatDate(firstDate)}` : ''}. La evolución y la
          variación diaria aparecerán cuando haya un segundo scrape.
        </p>
      )}

      <section className="section" aria-labelledby="chart-title">
        <div className="section__head">
          <h2 id="chart-title">Evolución del precio</h2>
          <p className="section__note">
            {days >= 2
              ? `${days} días de observaciones reales · PVPR y hitos comerciales marcados`
              : 'Un único punto registrado: no se dibuja ninguna tendencia'}
          </p>
        </div>
        <div className="panel">
          {series.length === 0 ? (
            <p className="empty-note">
              Todavía no hay observaciones de precio para este producto. El gráfico aparecerá
              cuando el scraper registre el primer dato.
            </p>
          ) : (
            <PriceChart series={series} pvpr={product.pvpr} productName={product.name} />
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="history-title">
        <div className="section__head">
          <h2 id="history-title">Historial de precios</h2>
          <p className="section__note">
            Una fila por día (última observación) · variación respecto al día anterior
          </p>
        </div>
        <div className="panel panel--table">
          {rows.length === 0 ? (
            <p className="empty-note">No hay observaciones de precio para este producto.</p>
          ) : (
            <div className="table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Precio</th>
                    <th scope="col">Variación diaria</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.date}>
                      <th scope="row">{formatDate(row.date)}</th>
                      <td className="num">{formatPrice(row.price)}</td>
                      <td
                        className={`num ${
                          row.delta === null ? 'is-flat' : row.delta < 0 ? 'is-down' : row.delta > 0 ? 'is-up' : 'is-flat'
                        }`}
                      >
                        {row.delta === null
                          ? '—'
                          : row.delta === 0
                          ? 'Sin cambios'
                          : `${formatSignedPrice(row.delta)}${
                              row.pct !== null ? ` (${formatPct(row.pct)})` : ''
                            }`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
