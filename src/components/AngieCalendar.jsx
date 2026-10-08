import { useState } from 'react'
import Modal from './Modal'
import { hoyBogota } from '../lib/format'
import { calendarDays, shiftMonth } from '../lib/calendar'

export default function AngieCalendar({ value, onChange, onClose }) {
  const today = hoyBogota()
  const [selected, setSelected] = useState(value || today)
  const [month, setMonth] = useState((value || today).slice(0, 7))
  const title = new Date(`${month}-01T12:00:00Z`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return <Modal title="Elegir fecha" className="angie-calendar" onClose={onClose} footer={<div className="calendar-actions">
    <button className="btn sec" onClick={() => { setSelected(today); setMonth(today.slice(0, 7)) }}>Hoy</button>
    <button className="btn sec" onClick={onClose}>Cancelar</button>
    <button className="btn" onClick={() => { onChange(selected); onClose() }}>Confirmar</button>
  </div>}>
    <div className="calendar-selected-summary"><span className="premium-eyebrow">FECHA DEL MOVIMIENTO</span><p><strong>{Number(selected.slice(8))}</strong><span>{new Date(`${selected}T12:00:00Z`).toLocaleDateString('es-CO', { month:'long', year:'numeric', timeZone:'UTC' })}<small>{new Date(`${selected}T12:00:00Z`).toLocaleDateString('es-CO', { weekday:'long', timeZone:'UTC' })}</small></span></p></div>
    <div className="calendar-month"><button className="btn sec" aria-label="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button><b aria-live="polite">{title}</b><button className="btn sec" aria-label="Mes siguiente" onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div>
    <div className="calendar-week" aria-hidden="true">{['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'].map(day => <span key={day}>{day}</span>)}</div>
    <div className="calendar-days" role="group" aria-label="Días del mes">{calendarDays(month).map(day => <button key={day} type="button" data-date={day} className={(day.slice(0,7) !== month ? 'outside ' : '') + (day === today ? 'today ' : '') + (day === selected ? 'selected' : '')} aria-label={new Date(`${day}T12:00:00Z`).toLocaleDateString('es-CO', { day:'numeric', month:'long', year:'numeric', timeZone:'UTC' })} aria-pressed={day === selected} aria-current={day === today ? 'date' : undefined} onClick={() => setSelected(day)}>{Number(day.slice(8))}</button>)}</div>
  </Modal>
}
