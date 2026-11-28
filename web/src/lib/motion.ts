import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger)

let lenis: Lenis | null = null
let tickHandler: ((time: number) => void) | null = null

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function getLenis(): Lenis | null {
  return lenis
}

export function initSmoothScroll(): Lenis | null {
  if (lenis || prefersReducedMotion()) return lenis
  lenis = new Lenis({
    duration: 1.1,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    syncTouch: false,
  })
  lenis.on('scroll', ScrollTrigger.update)
  tickHandler = (time: number) => {
    lenis?.raf(time * 1000)
  }
  gsap.ticker.add(tickHandler)
  gsap.ticker.lagSmoothing(0)
  return lenis
}

export function destroySmoothScroll(): void {
  if (!lenis) return
  if (tickHandler) gsap.ticker.remove(tickHandler)
  tickHandler = null
  lenis.destroy()
  lenis = null
}

export function scrollToTop(immediate = true): void {
  if (lenis) lenis.scrollTo(0, { immediate })
  else window.scrollTo({ top: 0, behavior: 'auto' })
}

export function scrollToY(value: number, immediate = true): void {
  if (lenis) lenis.scrollTo(value, { immediate })
  else window.scrollTo({ top: value, behavior: 'auto' })
}

export function scrollToTarget(target: string | HTMLElement, offset = -80): void {
  if (lenis) {
    lenis.scrollTo(target, { offset, duration: 1.1 })
    return
  }
  const element = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target
  element?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
}

/** Fade + y al entrar en el 85 % del viewport, una sola vez. */
export function revealSections(scope: HTMLElement): () => void {
  if (prefersReducedMotion()) return () => undefined
  const sections = [...scope.querySelectorAll<HTMLElement>('[data-reveal]')]
  const triggers: ScrollTrigger[] = []
  sections.forEach((section) => {
    gsap.set(section, { opacity: 0, y: 24 })
    triggers.push(
      ScrollTrigger.create({
        trigger: section,
        start: 'top 85%',
        once: true,
        onEnter: () => {
          gsap.to(section, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out' })
        },
      })
    )
  })
  return () => {
    triggers.forEach((trigger) => trigger.kill())
    sections.forEach((section) => gsap.set(section, { clearProps: 'opacity,transform' }))
  }
}

export function staggerCards(
  container: HTMLElement | null,
  selector: string,
  fromIndex = 0
): void {
  if (!container || prefersReducedMotion()) return
  const cards = [...container.querySelectorAll<HTMLElement>(selector)].slice(fromIndex)
  if (!cards.length) return
  gsap.fromTo(
    cards.slice(0, 12),
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.4, stagger: 0.02, ease: 'power2.out', clearProps: 'transform' }
  )
  if (cards.length > 12) {
    gsap.set(cards.slice(12), { opacity: 1, y: 0 })
  }
}

export function countUp(
  node: HTMLElement | null,
  value: number,
  format: (n: number) => string,
  duration = 1200
): void {
  if (!node) return
  node.textContent = format(value)
  if (prefersReducedMotion()) return
  const state = { value: 0 }
  gsap.to(state, {
    value,
    duration: duration / 1000,
    ease: 'power2.out',
    onUpdate: () => {
      node.textContent = format(state.value)
    },
    onComplete: () => {
      node.textContent = format(value)
    },
  })
}

export { gsap, ScrollTrigger }
