import { Icon } from './Icons'
import { AnimatedCard } from './TechVisuals'
import { useId, useState } from 'react'

export function Field({ label, children }) {
  return <div className="mb-3"><label className="lbl">{label}</label>{children}</div>
}
export function Input({ label, inputRef, ...p }) {
  const id = useId()
  const [error, setError] = useState('')
  const type = p.type || (/tel[eé]fono/i.test(label) ? 'tel' : 'text')
  return <div className="mb-3"><label className="lbl" htmlFor={p.id || id}>{label}</label><input ref={inputRef} className="inp" id={id} {...p} type={type} inputMode={p.inputMode || (type === 'number' ? 'decimal' : undefined)} aria-invalid={!!error} aria-describedby={error ? id + '-error' : undefined} onInvalid={e => { e.preventDefault(); setError(e.target.validity.valueMissing ? 'Completa este campo.' : type === 'email' ? 'Escribe un correo válido.' : 'Revisa el valor y los límites indicados.') }} onBlur={e=>{e.target.checkValidity();p.onBlur?.(e)}} onChange={e => { setError(''); p.onChange?.(e) }} />{error && <p id={id + '-error'} className="text-xs text-bad" role="alert">{error}</p>}</div>
}
export function Select({ label, children, ...p }) {
  const id = useId()
  const [error,setError]=useState('')
  return <div className="mb-3"><label className="lbl" htmlFor={p.id || id}>{label}</label><select className="inp" id={id} {...p} aria-invalid={!!error} onInvalid={e=>{e.preventDefault();setError('Elige una opción.')}} onChange={e=>{setError('');p.onChange?.(e)}}>{children}</select>{error&&<p role="alert" className="text-xs text-bad">{error}</p>}</div>
}
export const Empty = ({ text = 'Sin resultados', description = 'Prueba otra búsqueda o cambia los filtros para encontrar lo que necesitas.', action, actionLabel = 'Crear registro' }) => <div className="empty-state"><Icon name="box" className="w-7 h-7" /><p>{text}</p><p className="text-xs">{description}</p>{action && <button className="btn sec" onClick={action}>{actionLabel}</button>}</div>
export const Loader = () => <div className="loading-state" role="status"><span className="loading-mark" />Cargando…</div>
export const ErrorBox = ({ text }) => text ? <div role="alert" className="bg-badbg text-bad rounded-xl p-3 text-sm mb-3">{text}</div> : null
export const Badge = ({ tone = '', children }) => <span className={'badge ' + tone}>{children}</span>

export function Stat({ label, value, tone, sub, icon = 'chart', index = 0, onClick }) {
  const c = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-ink'
  return (
    <AnimatedCard as={onClick ? 'button' : 'div'} type={onClick ? 'button' : undefined} onClick={onClick} aria-label={onClick ? label : undefined} className="card stat-card" index={index}>
      <div className="stat-heading"><p>{label}</p><span className="stat-icon"><Icon name={icon} /></span></div>
      <p key={String(value)} className={'stat-value motion-value ' + c}>{value}</p>
      {sub && <p className="text-[11px] text-muted m-0 mt-0.5">{sub}</p>}
    </AnimatedCard>
  )
}

export function SearchBar({ value, onChange, placeholder = 'Buscar…', onScan }) {
  return (
    <div className="search-bar flex gap-2 mb-3">
      <div className="relative flex-1 min-w-0">
        <Icon name="search" className="w-4 h-4 absolute left-3 top-3.5 text-muted" />
        <input type="search" enterKeyHint="search" autoCorrect="off" spellCheck={false} className="inp !pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoCapitalize="none" />
      </div>
      {onScan && <button className="btn sec scan-button !px-3" onClick={onScan} aria-label="Escanear"><Icon name="scan" className="w-5 h-5" /></button>}
    </div>
  )
}

export function Chips({ options, value, onChange }) {
  return (
    <div className="chips flex gap-2 overflow-x-auto pb-2 mb-2" aria-label="Filtros">
      {options.map((o) => (
        <button key={o.value} aria-pressed={value === o.value} className={'chip ' + (value === o.value ? 'on' : '')} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Stepper({ value, onChange, min = 1, max = 9999 }) {
  return (
    <div className="stepper flex items-center gap-1">
      <button className="btn sec sm" aria-label="Reducir cantidad" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span key={value} className="font-bold w-6 text-center motion-value">{value}</span>
      <button className="btn sec sm" aria-label="Aumentar cantidad" onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  )
}
