import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

export interface SegmentedOption {
  value: string
  label: string
  count?: number
}

interface SegmentedProps {
  options: SegmentedOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel: string
}

export default function Segmented({ options, value, onChange, ariaLabel }: SegmentedProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState({ x: 0, width: 0 })

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const measure = () => {
      const active = wrap.querySelector<HTMLElement>('[data-active="true"]')
      if (active) setThumb({ x: active.offsetLeft, width: active.offsetWidth })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(wrap)
    void document.fonts?.ready.then(measure)
    return () => observer.disconnect()
  }, [value, options.map((option) => option.label).join('|')])

  return (
    <div
      ref={wrapRef}
      className="segmented"
      role="tablist"
      aria-label={ariaLabel}
      style={
        {
          '--thumb-x': `${thumb.x}px`,
          '--thumb-w': `${thumb.width}px`,
        } as CSSProperties
      }
    >
      <span className="segmented__thumb" aria-hidden="true" />
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            className={`segmented__option${active ? ' is-active' : ''}`}
            role="tab"
            aria-selected={active}
            data-active={active ? 'true' : 'false'}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="segmented__count">{option.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
