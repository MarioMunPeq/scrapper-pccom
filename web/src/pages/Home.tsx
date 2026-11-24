import { useMemo, useRef } from 'react'
import MedianChart from '../components/MedianChart'
import {
  computeGlobalSeries,
  formatDate,
  formatDateTime,
  formatPct,
  formatPrice0,
  intFmt,
  latestUpdate,
  median,
  shortName,
  type HistoryMap,
  type Product,
} from '../lib'

interface HomeProps {
  products: Product[]
  history: HistoryMap
}

export default function Home({ products, history }: HomeProps) {
  const dropsRef = useRef<HTMLElement | null>(null)

  const stats = useMemo(() => {
    const prices = products
      .map((product) => product.currentPrice)
      .filter((price): price is number => price !== null && Number.isFinite(price))
    const withDiscount = products.filter(
      (product) => product.discountPvpr !== null && product.discountPvpr > 0
    )
    const cheapest = [...products]
      .filter((product) => product.currentPrice !== null)
      .sort((a, b) => (a.currentPrice as number) - (b.currentPrice as number))[0]
    const priciest = [...products]
      .filter((product) => product.currentPrice !== null)
      .sort((a, b) => (b.currentPrice as number) - (a.currentPrice as number))[0]

    return {
      total: products.length,
      medianPrice: median(prices),
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      withDiscount: withDiscount.length,
      discountPct: products.length ? (withDiscount.length / products.length) * 100 : 0,
      cheapest,
      priciest,
      updated: latestUpdate(products),
      days: Math.max(0, ...products.map((product) => product.numDiasHistorial)),
    }
  }, [products])

  const globalSeries = useMemo(() => computeGlobalSeries(history), [history])
  const hasComparison = stats.days >= 2

  const topDrops = useMemo(
    () =>
      products
        .filter((product) => product.recentDropPct !== null && product.recentDropPct > 0)
        .sort((a, b) => (b.recentDropPct as number) - (a.recentDropPct as number))
        .slice(0, 6),
    [products]
  )

  const topDiscounts = useMemo(
    () =>
      products
        .filter((product) => product.discountPvpr !== null && product.discountPvpr > 0)
        .sort((a, b) => (b.discountPvpr as number) - (a.discountPvpr as number))
        .slice(0, 6),
    [products]
  )

  const lastGlobal = globalSeries[globalSeries.length - 1]

  return (
    <div className="page page--home">
      <header className="hero">
        <div className="hero__copy">
          <p className="eyebrow">
            <span className="dot" aria-hidden="true" />
            PcComponentes · {intFmt.format(stats.total)} equipos monitorizados
          </p>
          <h1>
            El precio real de cada PC,
            <br />
            <span className="hero__accent">día a día.</span>
          </h1>
          <p className="hero__lead">
            Histórico propio de precios de ordenadores de sobremesa. Sin descuentos inventados:
            cada cifra sale de un scrape diario y se puede comprobar en el histórico de cada
            producto.
          </p>
          <div className="hero__actions">
            <a className="btn btn--primary" href="#/listado">
              Explorar los {intFmt.format(stats.total)} PCs
            </a>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => dropsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              Ver quién baja de precio
            </button>
          </div>
          <p className="hero__meta">
            {stats.updated
              ? `Última actualización: ${formatDateTime(stats.updated)}`
              : 'Todavía sin datos de precios'}
            <span className="hero__meta-sep">·</span>
            Precios actualizados a diario
            <span className="hero__meta-sep">·</span>
            {hasComparison
              ? `${stats.days} días de histórico`
              : 'Histórico en construcción'}
          </p>
        </div>

        <div className="hero__panel" aria-label="Resumen del mercado">
          <span className="hero__panel-label">Mediana hoy</span>
          <strong className="hero__panel-value">{formatPrice0(stats.medianPrice)}</strong>
          <span className="hero__panel-note">
            {lastGlobal
              ? `${intFmt.format(lastGlobal.count)} equipos con precio registrado`
              : 'Sin registros'}
          </span>
          <div className="hero__panel-grid">
            <div>
              <span className="hero__panel-key">Mínimo</span>
              <span className="hero__panel-figure">{formatPrice0(stats.minPrice)}</span>
            </div>
            <div>
              <span className="hero__panel-key">Máximo</span>
              <span className="hero__panel-figure">{formatPrice0(stats.maxPrice)}</span>
            </div>
            <div>
              <span className="hero__panel-key">Con descuento</span>
              <span className="hero__panel-figure">
                {intFmt.format(stats.withDiscount)}
                <small>{formatPct(stats.discountPct)}</small>
              </span>
            </div>
            <div>
              <span className="hero__panel-key">Días de datos</span>
              <span className="hero__panel-figure">{intFmt.format(stats.days)}</span>
            </div>
          </div>
        </div>
      </header>

      <section className="section" aria-labelledby="kpi-title">
        <div className="section__head">
          <h2 id="kpi-title">Radiografía del catálogo</h2>
          <p className="section__note">Calculado sobre los {intFmt.format(stats.total)} PCs con datos.</p>
        </div>
        <div className="kpis">
          <div className="kpi">
            <span className="kpi__label">PCs monitorizados</span>
            <strong className="kpi__value">{intFmt.format(stats.total)}</strong>
            <span className="kpi__note">Todos con ficha y precio</span>
          </div>
          <div className="kpi">
            <span className="kpi__label">Precio mediano</span>
            <strong className="kpi__value">{formatPrice0(stats.medianPrice)}</strong>
            <span className="kpi__note">La mitad cuesta menos</span>
          </div>
          <div className="kpi">
            <span className="kpi__label">Más barato</span>
            <strong className="kpi__value">{formatPrice0(stats.minPrice)}</strong>
            <span className="kpi__note">{stats.cheapest ? shortName(stats.cheapest.name, 34) : '—'}</span>
          </div>
          <div className="kpi">
            <span className="kpi__label">Más caro</span>
            <strong className="kpi__value">{formatPrice0(stats.maxPrice)}</strong>
            <span className="kpi__note">{stats.priciest ? shortName(stats.priciest.name, 34) : '—'}</span>
          </div>
          <div className="kpi">
            <span className="kpi__label">Con descuento vs PVPR</span>
            <strong className="kpi__value">{intFmt.format(stats.withDiscount)}</strong>
            <span className="kpi__note">{formatPct(stats.discountPct)} del catálogo</span>
          </div>
          <div className="kpi">
            <span className="kpi__label">Última actualización</span>
            <strong className="kpi__value kpi__value--sm">{formatDate(stats.updated)}</strong>
            <span className="kpi__note">
              {stats.updated ? `${stats.updated.slice(11, 16)} h · scrape diario` : 'Sin datos'}
            </span>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="evolution-title">
        <div className="section__head">
          <h2 id="evolution-title">Mediana diaria y presión a la baja</h2>
          <p className="section__note">
            Precio mediano del catálogo cada día y cuántos PCs recortan precio respecto al día
            anterior.
          </p>
        </div>
        <div className="panel">
          <MedianChart points={globalSeries} />
        </div>
      </section>

      <section className="section" id="bajadas" ref={dropsRef} aria-labelledby="drops-title">
        <div className="section__head">
          <h2 id="drops-title">Quién se mueve</h2>
          <p className="section__note">
            Comparativas reales entre el último scrape y el anterior. Sin estimaciones.
          </p>
        </div>
        <div className="split">
          <div className="panel panel--list">
            <div className="panel__head">
              <h3>Mayores bajadas</h3>
              <span className="panel__hint">vs día anterior</span>
            </div>
            {!hasComparison || topDrops.length === 0 ? (
              <p className="empty-note">
                {hasComparison
                  ? 'Hoy ningún PC ha bajado de precio respecto al día anterior.'
                  : 'Disponible desde el próximo scrape: hacen falta al menos dos días de histórico para comparar.'}
              </p>
            ) : (
              <ol className="rank">
                {topDrops.map((product, index) => (
                  <li key={product.sku}>
                    <a className="rank__row" href={`#/product/${product.sku}`}>
                      <span className="rank__pos">{String(index + 1).padStart(2, '0')}</span>
                      <span className="rank__body">
                        <span className="rank__name">{shortName(product.name)}</span>
                        <span className="rank__meta">
                          {formatPrice0(product.previousPrice)} → {formatPrice0(product.currentPrice)}
                        </span>
                      </span>
                      <span className="rank__value is-down">
                        −{formatPct(product.recentDropPct)}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="panel panel--list">
            <div className="panel__head">
              <h3>Mejores descuentos</h3>
              <span className="panel__hint">vs PVPR</span>
            </div>
            {topDiscounts.length === 0 ? (
              <p className="empty-note">Ningún producto muestra PVPR tachado en la última captura.</p>
            ) : (
              <ol className="rank">
                {topDiscounts.map((product, index) => (
                  <li key={product.sku}>
                    <a className="rank__row" href={`#/product/${product.sku}`}>
                      <span className="rank__pos">{String(index + 1).padStart(2, '0')}</span>
                      <span className="rank__body">
                        <span className="rank__name">{shortName(product.name)}</span>
                        <span className="rank__meta">
                          {formatPrice0(product.currentPrice)} · PVPR {formatPrice0(product.pvpr)}
                        </span>
                      </span>
                      <span className="rank__value is-up">−{formatPct(product.discountPvpr)}</span>
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>

      <section className="section section--note" aria-label="Sobre los datos">
        <div className="method">
          <h2>Cómo se calcula</h2>
          <p>
            Cada día se guarda el precio final de la ficha de PcComponentes. La mediana y los
            rankings se recalculan con esas observaciones: no hay precios de relleno ni series
            inventadas. Si un producto solo tiene un día de datos, su gráfico lo indica y no se
            compara contra nada.
          </p>
          <p className="method__foot">
            Precios en euros con IVA incluido · Fuente: PcComponentes ·{' '}
            {stats.updated ? `actualizado el ${formatDate(stats.updated)}` : 'pendiente de datos'}
          </p>
        </div>
        <div className="method__figure" aria-hidden="true">
          <span>{formatPrice0(stats.medianPrice)}</span>
          <small>precio mediano</small>
        </div>
      </section>
    </div>
  )
}
