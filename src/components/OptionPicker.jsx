import { useMemo, useState } from 'react'
import Modal from './Modal'
import { I } from './InvIcons'

// Selector en hoja inferior con búsqueda, "+ Nuevo" y edición opcional (renombrar / ocultar)
export default function OptionPicker({ title, options, value, onPick, onClose, onAdd, onRename, onHide, addLabel = 'Nuevo', addPlaceholder = 'Nombre' }) {
  const [q, setQ] = useState('')
  const [nuevo, setNuevo] = useState(null)       // texto del nuevo elemento
  const [editando, setEditando] = useState(null) // { value, texto }
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const lista = useMemo(() => { const t = q.trim().toLowerCase(); return t ? options.filter(o => o.label.toLowerCase().includes(t)) : options }, [q, options])

  const run = async (fn) => { setErr(''); setBusy(true); try { await fn() } catch (e) { setErr(e?.message || String(e)) } finally { setBusy(false) } }
  const agregar = () => run(async () => {
    const t = (nuevo || '').trim(); if (!t) return setErr('Escribe un nombre.')
    if (options.some(o => o.label.toLowerCase() === t.toLowerCase())) return setErr('Ya existe en la lista.')
    const v = await onAdd(t); setNuevo(null); onPick(v ?? t)
  })
  const renombrar = () => run(async () => {
    const t = editando.texto.trim(); if (!t) return setErr('Escribe un nombre.')
    if (options.some(o => o.value !== editando.value && o.label.toLowerCase() === t.toLowerCase())) return setErr('Ya existe en la lista.')
    await onRename(editando.value, t); setEditando(null)
  })
  const ocultar = (o) => run(async () => { await onHide(o.value); setEditando(null) })

  return <Modal title={title} onClose={onClose} keyboardAware className="opt-sheet">
    {options.length > 6 && <label className="opt-search"><I n="search" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…" /></label>}
    {err && <p className="opt-err">{err}</p>}
    <div className="opt-list">
      {lista.map(o => editando?.value === o.value
        ? <div key={o.value} className="opt-row editing">
            <input autoFocus value={editando.texto} onChange={e => setEditando({ ...editando, texto: e.target.value })} onKeyDown={e => e.key === 'Enter' && renombrar()} />
            <button type="button" className="opt-mini gold" disabled={busy} onClick={renombrar}>Guardar</button>
            {onHide && <button type="button" className="opt-mini danger" disabled={busy} onClick={() => ocultar(o)}>Ocultar</button>}
            <button type="button" className="opt-mini" onClick={() => setEditando(null)} aria-label="Cancelar">✕</button>
          </div>
        : <div key={o.value} className={'opt-row' + (String(value) === String(o.value) ? ' on' : '')}>
            <button type="button" className="opt-pick" onClick={() => onPick(o.value)}>
              <span className="opt-ico">{o.icon}</span><span className="opt-label">{o.label}{o.sub && <small>{o.sub}</small>}</span>
              {String(value) === String(o.value) && <span className="opt-check">✓</span>}
            </button>
            {onRename && o.editable !== false && <button type="button" className="opt-edit" aria-label={`Editar ${o.label}`} onClick={() => { setErr(''); setEditando({ value: o.value, texto: o.label }) }}><I n="pencil" /></button>}
          </div>)}
      {lista.length === 0 && <p className="opt-empty">Sin resultados.</p>}
    </div>
    {onAdd && (nuevo === null
      ? <button type="button" className="opt-add" onClick={() => { setErr(''); setNuevo(q) }}><I n="plus" />{addLabel}</button>
      : <div className="opt-row editing add">
          <input autoFocus placeholder={addPlaceholder} value={nuevo} onChange={e => setNuevo(e.target.value)} onKeyDown={e => e.key === 'Enter' && agregar()} />
          <button type="button" className="opt-mini gold" disabled={busy} onClick={agregar}>Agregar</button>
          <button type="button" className="opt-mini" onClick={() => setNuevo(null)} aria-label="Cancelar">✕</button>
        </div>)}
  </Modal>
}
