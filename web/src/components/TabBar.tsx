import { Home, LayoutGrid, Star } from 'lucide-react'
import { HREFS, navActive, type View } from '../lib/router'

interface TabBarProps {
  view: View
  favoritesCount: number
}

export default function TabBar({ view, favoritesCount }: TabBarProps) {
  const active = navActive(view)
  const items = [
    { key: 'home' as const, label: 'Resumen', href: HREFS.home, icon: Home },
    { key: 'catalog' as const, label: 'Catálogo', href: HREFS.catalog, icon: LayoutGrid },
    { key: 'favorites' as const, label: 'Favoritos', href: HREFS.favorites, icon: Star },
  ]

  return (
    <nav className="tab-bar" aria-label="Navegación móvil">
      {items.map((item) => {
        const Icon = item.icon
        const isActive = active === item.key
        return (
          <a
            key={item.key}
            className={`tab-bar__item${isActive ? ' is-active' : ''}`}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="tab-bar__icon">
              <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
              {item.key === 'favorites' && favoritesCount > 0 && (
                <span className="tab-bar__badge" data-micro="true" aria-label={`${favoritesCount} favoritos`}>
                  {favoritesCount > 99 ? '99' : favoritesCount}
                </span>
              )}
            </span>
            <span>{item.label}</span>
          </a>
        )
      })}
    </nav>
  )
}
