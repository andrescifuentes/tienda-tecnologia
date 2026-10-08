import { useLayoutEffect } from 'react'

let retainedKeyboardBaseline = 0

// Safari resizes its visual viewport before/after focus events and can pan it.
// Keep the original layout height until the keyboard has actually disappeared.
export function useSearchViewport(deviceRef) {
  useLayoutEffect(() => {
    const viewport = window.visualViewport
    const device = deviceRef.current
    if (!viewport || !device) return
    let baseline = Math.max(window.innerHeight, document.documentElement.clientHeight, viewport.height, retainedKeyboardBaseline)
    let engaged = retainedKeyboardBaseline > 0, hadKeyboard = engaged, frame
    const fit = () => {
      const active = document.activeElement
      const searching = device.contains(active) && active.matches('.search-bar input')
      if (searching) engaged = true
      const reduced = baseline - viewport.height > Math.max(120, baseline * .15)
      const keyboard = engaged && reduced && Math.abs(viewport.scale - 1) < .05
      if (keyboard) hadKeyboard = true
      // iPhone landscape can exceed 767px; its coarse pointer still identifies
      // a touch layout that needs the same keyboard frame and search composition.
      const mobile = window.matchMedia('(max-width:767px), (pointer:coarse)').matches
      const searchMode = mobile && (keyboard || searching && !hadKeyboard)
      device.classList.toggle('search-keyboard', keyboard)
      device.classList.toggle('search-mode', searchMode)
      if (searchMode) {
        if (keyboard) retainedKeyboardBaseline = baseline
        device.style.setProperty('--search-viewport-height', `${viewport.height}px`)
        device.style.setProperty('--search-viewport-top', `${viewport.offsetTop}px`)
        if (searching) {
          const view = device.querySelector('.view')
          const field = active.getBoundingClientRect(), bounds = view.getBoundingClientRect()
          const delta = field.top < bounds.top + 8 ? field.top - bounds.top - 8 : field.bottom > bounds.bottom - 8 ? field.bottom - bounds.bottom + 8 : 0
          if (delta) view.scrollBy({ top: delta, behavior: 'instant' })
        }
      } else {
        device.style.removeProperty('--search-viewport-height')
        device.style.removeProperty('--search-viewport-top')
        if (!reduced) {
          retainedKeyboardBaseline = 0
          engaged = searching
          baseline = Math.max(window.innerHeight, document.documentElement.clientHeight, viewport.height)
        }
      }
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit) }
    const focus = event => {
      // A modal restores focus to the search while Safari is closing its keyboard.
      // Preserve that cycle; only a new focus from the normal screen starts one.
      if (device.contains(event.target) && event.target.matches('.search-bar input') && !event.target.hasAttribute('data-dialog-restoring-focus') && !device.classList.contains('search-mode')) hadKeyboard = false
      schedule()
    }
    const orientation = () => {
      engaged = false
      hadKeyboard = false
      retainedKeyboardBaseline = 0
      baseline = Math.max(window.innerHeight, document.documentElement.clientHeight, viewport.height)
      schedule()
    }
    fit()
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', orientation)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', schedule)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('orientationchange', orientation)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', schedule)
    }
  }, [deviceRef])
}
