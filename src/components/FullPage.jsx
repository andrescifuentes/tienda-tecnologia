import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { I } from './InvIcons'

// Pantalla completa (detalle y formularios)
export default function FullPage({ title, onBack, menu, footer, children, className = '' }) {
  useEffect(() => { document.documentElement.classList.add('fp-open'); return () => document.documentElement.classList.remove('fp-open') }, [])
  return createPortal(<div className={'fp-overlay ' + className} role="dialog" aria-modal="true" aria-label={title}>
    <div className="fp">
      <header className="fp-head">
        <button type="button" className="fp-icon" onClick={onBack} aria-label="Volver"><I n="back" /></button>
        <h1>{title}</h1>
        {menu || <span className="fp-icon-space" />}
      </header>
      <div className="fp-body">{children}</div>
      {footer && <div className="fp-foot">{footer}</div>}
    </div>
  </div>, document.body)
}

