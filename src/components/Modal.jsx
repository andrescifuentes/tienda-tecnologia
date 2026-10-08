import { useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

let backgroundLocks = 0
let restoreBackground
function lockBackground() {
  if (backgroundLocks++ === 0) {
    const root = document.getElementById('root')
    const inert = root?.inert
    const page = { x: window.scrollX, y: window.scrollY }
    const elements = [document.documentElement, document.body, ...document.querySelectorAll('#root .view')]
    const saved = elements.map(element => ({ element, overflow: element.style.overflow, overscroll: element.style.overscrollBehavior, top: element.scrollTop, left: element.scrollLeft }))
    const bodyStyle = ['position','top','left','width'].map(key => [key,document.body.style[key]])
    elements.forEach(element => { element.style.overflow = 'hidden'; element.style.overscrollBehavior = 'none' })
    Object.assign(document.body.style, { position: 'fixed', top: `${-page.y}px`, left: `${-page.x}px`, width: '100%' })
    if (root) root.inert = true
    const preventBackgroundTouch = event => {
      if (!event.target.closest?.('.sheet-body') && event.cancelable) event.preventDefault()
    }
    document.addEventListener('touchmove', preventBackgroundTouch, { passive: false })
    restoreBackground = () => {
      document.removeEventListener('touchmove', preventBackgroundTouch)
      if (root) root.inert = inert
      bodyStyle.forEach(([key,value]) => { document.body.style[key] = value })
      saved.forEach(({ element, overflow, overscroll, top, left }) => {
        element.style.overflow = overflow; element.style.overscrollBehavior = overscroll
        element.scrollTop = top; element.scrollLeft = left
      })
      if (window.scrollX !== page.x || window.scrollY !== page.y) window.scrollTo(page.x, page.y)
    }
  }
  return () => { if (--backgroundLocks === 0) { restoreBackground(); restoreBackground = null } }
}

export default function Modal({ title, onClose, footer, children, expanded = false, className = '', subtitle, keyboardAware = false }) {
  const id = useId()
  const dialogRef = useRef(null)
  const overlayRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const viewport = window.visualViewport
    if (!keyboardAware || !viewport) return
    let frame
    let baseline = Math.max(window.innerHeight, document.documentElement.clientHeight, viewport.height)
    const fit = event => {
      const overlay = overlayRef.current
      // The backdrop always covers the app; only the sheet's frame follows Safari.
      overlay.style.setProperty('--dialog-viewport-top', `${viewport.offsetTop}px`)
      overlay.style.setProperty('--dialog-viewport-height', `${viewport.height}px`)
      const keyboard = baseline - viewport.height > Math.max(120, baseline * .15) && Math.abs(viewport.scale - 1) < .05
      overlay.classList.toggle('keyboard-open', keyboard)
      if (!keyboard && Math.abs(viewport.scale - 1) < .05) baseline = Math.max(window.innerHeight, document.documentElement.clientHeight, viewport.height)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const active = document.activeElement
        if (dialogRef.current?.contains(active) && active.matches('input,select,textarea')) {
          const body = dialogRef.current.querySelector('.sheet-body')
          const field = active.getBoundingClientRect(), bounds = body.getBoundingClientRect()
          const delta = field.bottom > bounds.bottom - 12 ? field.bottom - bounds.bottom + 12 : field.top < bounds.top + 12 ? field.top - bounds.top - 12 : 0
          if (delta) body.scrollBy({ top: delta, behavior: event?.type === 'focusin' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' })
        }
      })
    }
    fit(); viewport.addEventListener('resize', fit); viewport.addEventListener('scroll', fit)
    const dialog = dialogRef.current
    dialog.addEventListener('focusin', fit)
    return () => { cancelAnimationFrame(frame); viewport.removeEventListener('resize', fit); viewport.removeEventListener('scroll', fit); dialog.removeEventListener('focusin', fit) }
  }, [keyboardAware])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const previous = document.activeElement
    const unlockBackground = lockBackground()
    dialog.focus()
    const keys = (event) => {
      const dialogs = document.querySelectorAll('[data-app-dialog]')
      if (dialogs[dialogs.length - 1] !== dialog) return
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current() }
      if (event.key !== 'Tab') return
      const elements = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')]
        .filter((element) => element.getClientRects().length)
      const first = elements[0], last = elements[elements.length - 1]
      if (!first) { event.preventDefault(); dialog.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keys)
    return () => {
      document.removeEventListener('keydown', keys)
      unlockBackground()
      if (previous?.isConnected) {
        // Returning focus after a dialog is not a new request to open search.
        // Safari can finish its closing resize before this cleanup runs.
        previous.setAttribute('data-dialog-restoring-focus', '')
        try { previous.focus({ preventScroll: true }) }
        finally { previous.removeAttribute('data-dialog-restoring-focus') }
      }
    }
  }, [])

  const sheet = <div className={'sheet' + (expanded ? ' sheet-expanded' : '') + (className ? ' ' + className : '')} ref={dialogRef} data-app-dialog role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined} aria-label={title ? undefined : 'Detalle'} tabIndex={-1}>
    <button className="sheet-x" onClick={onClose} aria-label="Cerrar">✕</button>
    {title && <h3 id={id}>{title}</h3>}
    {subtitle && <p className="sheet-subtitle">{subtitle}</p>}
    <div className="sheet-body">{children}</div>
    {footer && <div className="sheet-foot">{footer}</div>}
  </div>

  return createPortal(
    <div ref={overlayRef} className={'overlay' + (keyboardAware ? ' keyboard-aware-overlay' : '')} onClick={(e) => { if (e.target === e.currentTarget) onClose() }} onClickCapture={e => {
      const button = e.target.closest('button')
      if (!button || !button.closest('.sheet-foot') || button.closest('.sheet') !== dialogRef.current || button.classList.contains('sec')) return
      const inputs = [...dialogRef.current.querySelectorAll('.sheet-body input:not(:disabled),.sheet-body select:not(:disabled),.sheet-body textarea:not(:disabled)')]
      const invalid = inputs.filter(input => !input.checkValidity())
      if (invalid.length) { e.preventDefault(); e.stopPropagation(); invalid[0].focus(); invalid[0].scrollIntoView({ block: 'center' }) }
    }}>
      {keyboardAware ? <div className="modal-viewport">{sheet}</div> : sheet}
    </div>,
    document.body,
  )
}
