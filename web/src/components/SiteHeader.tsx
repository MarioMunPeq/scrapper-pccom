import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { HREFS, navActive, type View } from '../lib/router'

interface SiteHeaderProps {
  view: View
  favoritesCount: number
  updatedLabel: string | null
}

export default function SiteHeader({ view, favoritesCount, updatedLabel }: SiteHeaderProps) {
  const navRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState({ x: 0, width: 0, visible: false })
  const [scrolled, setScrolled] = useState(false)
  const active = navActive(view)

  const measure = () => {
    const nav = navRef.current
    if (!nav) return
    const current = nav.querySelector<HTMLElement>('[data-active="true"]')
    if (!current) {
      setPill((state) => ({ ...state, visible: false }))
      return
    }
    setPill({ x: current.offsetLeft, width: current.offsetWidth, visible: true })
  }

  useLayoutEffect(() => {
    measure()
  }, [view, favoritesCount])

  useEffect(() => {
    measure()
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    void document.fonts?.ready.then(measure)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const items: { key: 'home' | 'catalog' | 'favorites'; label: string; href: string }[] = [
    { key: 'home', label: 'Resumen', href: HREFS.home },
    { key: 'catalog', label: 'Catálogo', href: HREFS.catalog },
    { key: 'favorites', label: 'Favoritos', href: HREFS.favorites },
  ]

  return (
    <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="container site-header__inner">
        <a className="wordmark" href={HREFS.home} aria-label="tracker/5070 · Inicio">
          tracker<span className="wordmark__slash">/</span>5070
        </a>

        <nav
          ref={navRef}
          className="site-nav"
          aria-label="Navegación principal"
          style={
            {
              '--pill-x': `${pill.x}px`,
              '--pill-w': `${pill.width}px`,
              '--pill-o': pill.visible ? 1 : 0,
            } as CSSProperties
          }
        >
          <span className="site-nav__pill" aria-hidden="true" />
          {items.map((item) => {
            const isActive = active === item.key
            return (
              <a
                key={item.key}
                className={`site-nav__link${isActive ? ' is-active' : ''}`}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                data-active={isActive ? 'true' : 'false'}
              >
                {item.label}
                {item.key === 'favorites' && favoritesCount > 0 && (
                  <span className="site-nav__count" aria-label={`${favoritesCount} favoritos`}>
                    {favoritesCount}
                  </span>
                )}
              </a>
            )
          })}
        </nav>

        <span className="site-header__mobile-date">
          {updatedLabel ? `Act. ${updatedLabel}` : 'Sin datos'}
        </span>
      </div>
    </header>
  )
}
