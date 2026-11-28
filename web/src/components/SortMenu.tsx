import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { SORT_LABELS, SORT_ORDER, type SortKey } from '../lib/data'

interface SortMenuProps {
  value: SortKey
  onChange: (value: SortKey) => void
}

export default function SortMenu({ value, onChange }: SortMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="sort" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="sort-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="sort-btn__label">Ordenar</span>
        <span className="sort-btn__value">{SORT_LABELS[value]}</span>
        <ChevronDown size={14} strokeWidth={1.7} aria-hidden="true" />
      </button>
      {open && (
        <div className="sort-menu" role="menu" aria-label="Ordenar resultados">
          {SORT_ORDER.map((option) => {
            const active = option === value
            return (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`sort-menu__item${active ? ' is-active' : ''}`}
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                  buttonRef.current?.focus()
                }}
              >
                <span>{SORT_LABELS[option]}</span>
                {active && <Check size={14} strokeWidth={2} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
