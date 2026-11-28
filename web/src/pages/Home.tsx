import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import PriceChart from '../components/PriceChart'
import Sparkline from '../components/Sparkline'
import ChipDelta from '../components/ChipDelta'
import Segmented from '../components/Segmented'
import type { Meta, Product } from '../lib/data'
import { activeProducts, datasetStats, movements, priceRanges } from '../lib/data'
import {
  formatDateTime,
  formatDayMonth,
  formatNumber,
  formatPct,
  formatPrice,
  formatPrice2,
  formatPriceRange,
} from '../lib/format'
import { catalogHref, HREFS, productHref } from '../lib/router'
import { MILESTONES } from '../lib/milestones'
import { gsap, prefersReducedMotion, revealSections, scrollToTarget } from '../lib/motion'

interface HomeProps {
  products: Product[]
  meta: Meta
  onOpenProduct: (sku: string) => void
}

type MovementTab = 'down' | 'up' | 'new'

function trendClass(values: number[]): string {
  if (values.length < 2) return 'is-flat'
  if (values[values.length - 1] < values[0]) return 'is-down'
  if (values[values.length - 1] > values[0]) return 'is-up'
  return 'is-flat'
}

function MovementRow({
  product,
  rank,
  mode,
  onOpen,
}: {
  product: Product
  rank: number
  mode: MovementTab
  onOpen: (sku: string) => void
}) {
  const isNew = mode === 'new'
  const values = product.sparkline.length
    ? product.sparkline
    : product.currentPrice !== null
      ? [product.currentPrice]
      : []
  return (
    <a
      className="movement"
      href={productHref(product.sku)}
      onClick={() => onOpen(product.sku)}
    >
      <span className="movement__pos">{String(rank + 1).padStart(2, '0')}</span>
      <span className="movement__body">
        <span className="movement__name">{product.shortName}</span>
        <span className="movement__meta">
          <span>{product.cpuFamily}</span>
          <span aria-hidden="true">·</span>
          <span>{product.availabilityShort || `${product.numDiasHistorial} días de histórico`}</span>
        </span>
      </span>
      <span className="movement__spark" aria-hidden="true">
        <Sparkline values={values} className={trendClass(values)} />
      </span>
      <span className="movement__prices">
        <span className="movement__old">
          {isNew
            ? product.firstSeen
              ? `Desde ${formatDayMonth(product.firstSeen)}`
              : 'Primera observación'
            : formatPrice(product.prevPrice)}
        </span>
        <span className="movement__new">{formatPrice2(product.currentPrice)}</span>
      </span>
      <span className="movement__chip">
        {isNew ? (
          <span className="badge badge--new" data-micro="true">Nuevo</span>
        ) : (
          <ChipDelta pct={product.deltaPct} abs={product.deltaAbs} />
        )}
      </span>
    </a>
  )
}

export default function Home({ products, meta, onOpenProduct }: HomeProps) {
  const scopeRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [tab, setTab] = useState<MovementTab>('down')

  const active = useMemo(() => activeProducts(products), [products])
  const stats = useMemo(
    () => datasetStats({ products, history: {}, meta }),
    [products, meta]
  )
  const down = useMemo(() => movements(products, 'down', 8), [products])
  const up = useMemo(() => movements(products, 'up', 8), [products])
  const fresh = useMemo(
    () => active.filter((product) => product.isNew).slice(0, 8),
    [active]
  )
  const ranges = useMemo(() => priceRanges(active, 500), [active])
  const maxRange = Math.max(1, ...ranges.map((bucket) => bucket.count))
  const rangeTotal = ranges.reduce((sum, bucket) => sum + bucket.count, 0)
  const medians = meta.scrapes
    .filter((scrape) => scrape.median !== null)
    .map((scrape) => [scrape.date, scrape.median] as [string, number])
  const dropBars = meta.scrapes.map((scrape) => ({ date: scrape.date, value: scrape.drops }))
  const previous = meta.scrapes.length >= 2 ? meta.scrapes[meta.scrapes.length - 2] : null
  const firstScrape = meta.scrapes[0]
  const lastScrape = meta.scrapes[meta.scrapes.length - 1]

  useEffect(() => {
    if (prefersReducedMotion() || !scopeRef.current) return
    const scope = scopeRef.current
    const context = gsap.context(() => {
      const lines = titleRef.current?.querySelectorAll<HTMLElement>('.hero__line > span')
      if (lines && lines.length) {
        gsap.fromTo(
          lines,
          { yPercent: 110 },
          { yPercent: 0, duration: 0.9, stagger: 0.08, ease: 'power3.out', delay: 0.08 }
        )
      }
      gsap.fromTo(
        '.hero__lead, .hero__actions, .hero__meta, .hero-panel',
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.7, stagger: 0.08, ease: 'power2.out', delay: 0.3 }
      )
    }, scope)
    const cleanup = revealSections(scope)
    return () => {
      context.revert()
      cleanup()
    }
  }, [])

  const currentList =
    tab === 'down'
      ? down.map((movement) => ({ product: movement.product, mode: 'down' as const }))
      : tab === 'up'
        ? up.map((movement) => ({ product: movement.product, mode: 'up' as const }))
        : fresh.map((product) => ({ product, mode: 'new' as const }))

  return (
    <div className="page home" ref={scopeRef}>
      <div className="home-glow" aria-hidden="true" />

      <div className="container">
        <header className="hero">
          <div>
            <p className="eyebrow">
              <span className="eyebrow__dot" aria-hidden="true" />
              PcComponentes · {formatNumber(stats.withPrice)} equipos monitorizados
            </p>
            <h1 className="hero__title" ref={titleRef}>
              <span className="hero__line">
                <span>El precio real</span>
              </span>
              <span className="hero__line">
                <span>de cada PC,</span>
              </span>
              <span className="hero__line hero__line--italic">
                <span>día a día.</span>
              </span>
            </h1>
            <p className="hero__lead">
              Histórico propio de precios de ordenadores de sobremesa. Sin descuentos
              inventados: cada cifra sale de un scrape diario y se puede comprobar en el
              histórico de cada producto.
            </p>
            <div className="hero__actions">
              <a className="btn btn--primary" href={HREFS.catalog}>
                Explorar los {formatNumber(stats.total)} PCs
                <ArrowRight className="btn__arrow" size={16} strokeWidth={1.7} aria-hidden="true" />
              </a>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => scrollToTarget('#movimientos')}
              >
                Ver quién se mueve
              </button>
            </div>
            <p className="hero__meta">
              <span>
                {stats.updated
                  ? `Última actualización ${formatDateTime(stats.updated)}`
                  : 'Todavía sin datos'}
              </span>
              <span className="hero__meta-sep" aria-hidden="true">
                ·
              </span>
              <span>
                {meta.scrapes.length} {meta.scrapes.length === 1 ? 'scrape' : 'scrapes'} de
                histórico
              </span>
              <span className="hero__meta-sep" aria-hidden="true">
                ·
              </span>
              <span>Precios con IVA incluido</span>
            </p>
          </div>

          <aside className="hero-panel" aria-label="Resumen del mercado">
            <div className="hero-panel__head">
              <span className="mono-label">Precio mediano</span>
              <span className="hero-panel__live">
                {meta.lastScrape ? `Act. ${formatDayMonth(meta.lastScrape)}` : 'Sin datos'}
              </span>
            </div>
            <div className="hero-panel__median">
              <strong className="hero-panel__value">{formatPrice(stats.medianPrice)}</strong>
            </div>
            <div className="hero-panel__caption">
              {stats.medianDeltaPct !== null && stats.prevScrape ? (
                <ChipDelta
                  pct={stats.medianDeltaPct}
                  title={`Frente al scrape del ${formatDayMonth(stats.prevScrape.date)}`}
                />
              ) : null}
              <span>Mediana de {formatNumber(stats.withPrice)} PCs con precio</span>
            </div>

            <div className="hero-panel__grid">
              <div>
                <span className="hero-panel__key">Mínimo</span>
                <strong className="hero-panel__figure">{formatPrice(stats.minPrice)}</strong>
              </div>
              <div>
                <span className="hero-panel__key">Máximo</span>
                <strong className="hero-panel__figure">{formatPrice(stats.maxPrice)}</strong>
              </div>
              <div>
                <span className="hero-panel__key">Con descuento</span>
                <strong className="hero-panel__figure">
                  {formatNumber(stats.withDiscount)}
                  <small>{formatPct(stats.discountShare)}</small>
                </strong>
              </div>
              <div>
                <span className="hero-panel__key">Histórico</span>
                <strong className="hero-panel__figure">
                  {meta.scrapes.length}
                  <small>{meta.scrapes.length === 1 ? 'scrape' : 'scrapes'}</small>
                </strong>
              </div>
            </div>

            <p className="hero-panel__foot">
              {stats.updated
                ? `Actualizado el ${formatDateTime(stats.updated)}`
                : 'Pendiente de datos'}
            </p>
          </aside>
        </header>

        <section className="section" data-reveal aria-labelledby="evolucion-title">
          <div className="section-head">
            <div className="section-head__main">
              <span className="section-head__index">01</span>
              <div>
                <h2 id="evolucion-title">Evolución</h2>
              </div>
            </div>
            <p className="section-head__note">
              Precio mediano del catálogo en cada scrape y cuántos PCs recortan precio respecto
              a la observación anterior.
            </p>
          </div>
          <div className="chart-panel">
            <div className="chart-panel__head">
              <div>
                <p className="chart-panel__title">Mediana del catálogo</p>
                <p className="chart-panel__meta">
                  {firstScrape && lastScrape
                    ? `${formatDayMonth(firstScrape.date)} — ${formatDayMonth(lastScrape.date)} · ${
                        meta.scrapes.length
                      } ${meta.scrapes.length === 1 ? 'scrape' : 'scrapes'}`
                    : 'Sin observaciones'}
                </p>
              </div>
              <div className="legend" aria-hidden="true">
                <span className="legend__key">
                  <span className="legend__swatch legend__swatch--line" /> Mediana
                </span>
                <span className="legend__key">
                  <span className="legend__swatch legend__swatch--bar" /> PCs que bajan
                </span>
              </div>
            </div>
            <PriceChart
              points={medians}
              bars={dropBars}
              milestones={MILESTONES}
              height={340}
              chartLabel="Mediana diaria del catálogo"
              emptyLabel="Sin scrapes todavía"
            />
          </div>
        </section>

        <section className="section" id="movimientos" data-reveal aria-labelledby="movimientos-title">
          <div className="section-head">
            <div className="section-head__main">
              <span className="section-head__index">02</span>
              <div>
                <h2 id="movimientos-title">Movimientos</h2>
              </div>
            </div>
            <p className="section-head__note">
              Comparativas reales entre el último scrape y el anterior. Sin estimaciones ni
              precios de relleno.
            </p>
          </div>

          <div className="movements">
            <div className="movements__head">
              <Segmented
                ariaLabel="Tipo de movimiento"
                value={tab}
                onChange={(value) => setTab(value as MovementTab)}
                options={[
                  { value: 'down', label: 'Bajadas', count: down.length },
                  { value: 'up', label: 'Subidas', count: up.length },
                  { value: 'new', label: 'Nuevos', count: fresh.length },
                ]}
              />
              <span className="movements__hint">
                {previous ? `vs ${formatDayMonth(previous.date)}` : 'Sin comparativa'}
              </span>
            </div>

            {currentList.length > 0 ? (
              <div className="movements__list">
                {currentList.map((item, index) => (
                  <MovementRow
                    key={item.product.sku}
                    product={item.product}
                    rank={index}
                    mode={item.mode}
                    onOpen={onOpenProduct}
                  />
                ))}
              </div>
            ) : (
              <p className="movements__empty">
                {tab === 'down'
                  ? 'Ningún PC ha bajado de precio en el último scrape.'
                  : tab === 'up'
                    ? 'Ningún PC ha subido de precio en el último scrape.'
                    : 'Todavía no hay productos nuevos en el histórico.'}
              </p>
            )}
          </div>
        </section>

        <section className="section" data-reveal aria-labelledby="rangos-title">
          <div className="section-head">
            <div className="section-head__main">
              <span className="section-head__index">03</span>
              <div>
                <h2 id="rangos-title">Rangos de precio</h2>
              </div>
            </div>
            <p className="section-head__note">
              Distribución del catálogo por precio final. Cada tramo abre el catálogo ya
              filtrado; la barra azul marca la mediana.
            </p>
          </div>

          {ranges.length > 0 ? (
            <div className="ranges">
              {ranges.map((bucket) => (
                <a
                  key={`${bucket.from}-${bucket.to}`}
                  className={`range-row${bucket.isMedian ? ' range-row--median' : ''}`}
                  href={catalogHref({ range: `${bucket.from}-${bucket.to}` })}
                >
                  <span className="range-row__label">
                    {formatPriceRange(bucket.from, bucket.to)}
                    {bucket.isMedian && (
                      <span className="range-row__tag" data-micro="true">
                        mediana
                      </span>
                    )}
                  </span>
                  <span className="range-row__track">
                    <span
                      className="range-row__bar"
                      style={{ width: `${(bucket.count / maxRange) * 100}%` }}
                    />
                  </span>
                  <span className="range-row__count">{formatNumber(bucket.count)}</span>
                  <span className="range-row__pct">
                    {rangeTotal > 0 ? formatPct((bucket.count / rangeTotal) * 100) : '—'}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="movements__empty">Sin precios para construir rangos.</p>
          )}
        </section>
      </div>
    </div>
  )
}
