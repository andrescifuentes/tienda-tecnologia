import { I } from './InvIcons'
import { TODOS } from '../lib/locales'
import '../styles/locales.css'

// Selector de local para el administrador: «Todos los locales» o uno.
// Solo aparece cuando el negocio tiene más de un local.
export default function LocalSelector({ loc, className = '', conTodos = true, value, onChange, etiqueta = 'Local' }) {
  if (!loc?.multi) return null
  const actual = value !== undefined ? value : loc.seleccion
  const elegir = v => (onChange || loc.setSeleccion)(v)
  const opciones = [...(conTodos ? [{ id: TODOS, nombre: 'Todos' }] : []), ...loc.locales]
  return <div className={'loc-sel ' + className} role="radiogroup" aria-label={etiqueta}>
    <span className="loc-sel-ic" aria-hidden="true"><I n="store" /></span>
    <div className="loc-sel-track">
      {opciones.map(o => {
        const on = String(actual) === String(o.id)
        return <button key={o.id} type="button" role="radio" aria-checked={on} className={'loc-sel-opt' + (on ? ' on' : '')} data-todos={o.id === TODOS ? '' : undefined} onClick={() => elegir(o.id)}>{o.nombre}</button>
      })}
    </div>
  </div>
}

// Etiqueta pequeña con el nombre del local
export function LocalTag({ nombre, tono = '', className = '' }) {
  if (!nombre) return null
  return <span className={'loc-tag ' + tono + ' ' + className}><I n="store" />{nombre}</span>
}
