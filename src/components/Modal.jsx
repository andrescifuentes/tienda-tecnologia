import { createPortal } from 'react-dom'

export default function Modal({ title, onClose, footer, children }) {
  return createPortal(
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet">
        <button className="sheet-x" onClick={onClose} aria-label="Cerrar">✕</button>
        {title && <h3>{title}</h3>}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
