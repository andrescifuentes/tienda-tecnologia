import { Icon } from './Icons'

export function Field({ label, children }) {
  return <div className="mb-3"><label className="lbl">{label}</label>{children}</div>
}
export function Input({ label, ...p }) {
  return <Field label={label}><input className="inp" {...p} /></Field>
}
export function Select({ label, children, ...p }) {
  return <Field label={label}><select className="inp" {...p}>{children}</select></Field>
}
export const Empty = ({ text = 'Sin resultados' }) => <p className="text-muted text-center py-8 text-sm">{text}</p>
export const Loader = () => <p className="text-muted text-center py-8 text-sm">Cargando…</p>
export const ErrorBox = ({ text }) => text ? <div className="bg-badbg text-bad rounded-xl p-3 text-sm mb-3">{text}</div> : null
export const Badge = ({ tone = '', children }) => <span className={'badge ' + tone}>{children}</span>

export function Stat({ label, value, tone, sub }) {
  const c = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-ink'
  return (
    <div className="card !p-3">
      <p className="text-[11px] text-muted m-0">{label}</p>
      <p className={'text-lg font-bold mt-1 mb-0 ' + c}>{value}</p>
      {sub && <p className="text-[11px] text-muted m-0 mt-0.5">{sub}</p>}
    </div>
  )
}

export function SearchBar({ value, onChange, placeholder = 'Buscar…', onScan }) {
  return (
    <div className="flex gap-2 mb-3">
      <div className="relative flex-1">
        <Icon name="search" className="w-4 h-4 absolute left-3 top-3.5 text-muted" />
        <input className="inp !pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoCapitalize="none" />
      </div>
      {onScan && <button className="btn sec !px-3" onClick={onScan} aria-label="Escanear"><Icon name="scan" className="w-5 h-5" /></button>}
    </div>
  )
}

export function Chips({ options, value, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
      {options.map((o) => (
        <button key={o.value} className={'chip ' + (value === o.value ? 'on' : '')} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Stepper({ value, onChange, min = 1, max = 9999 }) {
  return (
    <div className="flex items-center gap-2">
      <button className="btn sec sm" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span className="font-bold w-6 text-center">{value}</span>
      <button className="btn sec sm" onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  )
}
