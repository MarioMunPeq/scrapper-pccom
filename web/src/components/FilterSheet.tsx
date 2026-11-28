import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import FilterPanel from './FilterPanel'
import { getLenis } from '../lib/motion'
import type { Filters, Product } from '../lib/data'

interface FilterSheetProps {
  open: boolean
  onClose: () => void
  products: Product[]
  filters: Filters
  favorites: Set<string>
  onChange: (filters: Filters) => void
  onClear: () => void
  resultCount: number
}

export default function FilterSheet({
  open,
  onClose,
  products,
  filters,
  favorites,
  onChange,
  onClear,
  resultCount,
}: FilterSheetProps) {
  const [rendered, setRendered] = useState(false)
  const [visible, setVisible] = useState(false)
  const [dragY, setDragY] = useState(0)
  const sheetRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const startY = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  closeRef.current = onClose

  useEffect(() => {
    if (open) {
      setRendered(true)
      const frame = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(frame)
    }
    setVisible(false)
    closeTimer.current = window.setTimeout(() => setRendered(false), 320)
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const lenis = getLenis()
    lenis?.stop()
    document.body.classList.add('is-locked')

    const focusables = () =>
      [
        ...(sheetRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []),
      ].filter((element) => element.offsetParent !== null)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const list = focusables()
      if (!list.length) return
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (event.shiftKey && (active === first || !active || !sheetRef.current?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.classList.remove('is-locked')
      lenis?.start()
      previous?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open || !rendered) return
    const autofocus = sheetRef.current?.querySelector<HTMLElement>('[data-autofocus]')
    autofocus?.focus()
  }, [open, rendered])

  if (!rendered) return null

  return (
    <>
      <div
        className={`sheet-backdrop${visible ? ' is-open' : ''}`}
        aria-hidden="true"
        onPointerDown={() => onClose()}
      />
      <div
        ref={sheetRef}
        className={`sheet${visible ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-sheet-title"
        tabIndex={-1}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
      >
        <div
          className="sheet__grab"
          aria-hidden="true"
          onPointerDown={(event) => {
            startY.current = event.clientY
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (startY.current === null) return
            setDragY(Math.max(0, event.clientY - startY.current))
          }}
          onPointerUp={() => {
            if (dragY > 120) onClose()
            setDragY(0)
            startY.current = null
          }}
          onPointerCancel={() => {
            setDragY(0)
            startY.current = null
          }}
        >
          <span />
        </div>
        <div className="sheet__head">
          <h3 className="sheet__title" id="filter-sheet-title">
            Filtros
          </h3>
          <button
            type="button"
            className="icon-btn"
            aria-label="Cerrar filtros"
            data-autofocus
            onClick={onClose}
          >
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>
        <div className="sheet__body">
          <FilterPanel
            products={products}
            filters={filters}
            favorites={favorites}
            onChange={onChange}
            onClear={onClear}
            hideHead
          />
        </div>
        <div className="sheet__foot">
          <button type="button" className="btn btn--secondary btn--md" onClick={onClear}>
            Limpiar
          </button>
          <button type="button" className="btn btn--primary btn--md" onClick={onClose}>
            Ver {resultCount} {resultCount === 1 ? 'PC' : 'PCs'}
          </button>
        </div>
      </div>
    </>
  )
}
