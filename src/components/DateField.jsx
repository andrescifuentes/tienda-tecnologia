import { useId, useState } from 'react'
import AngieCalendar from './AngieCalendar'
import { fecha } from '../lib/format'
import { Icon } from './Icons'

export default function DateField({ label = 'Fecha', value, onChange }) {
  const id = useId(), [open, setOpen] = useState(false)
  return <div className="date-field">
    <label htmlFor={id}><Icon name="calendar" />{label}</label>
    <button id={id} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><span>{fecha(value)}<small>Elegir fecha</small></span><span aria-hidden="true">›</span></button>
    {open && <AngieCalendar value={value} onChange={onChange} onClose={() => setOpen(false)} />}
  </div>
}
