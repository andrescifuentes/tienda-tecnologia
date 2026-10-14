import { useState } from 'react'
import ConfirmAction from './ConfirmAction'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/toast'

export default function RecordStatus({ table, record, onSaved }) {
  const [confirm, setConfirm] = useState(false)
  const active = record.activo !== false
  return <><button className={'btn full mt-3 ' + (active ? 'bad' : 'sec')} onClick={() => setConfirm(true)}>{active ? 'Desactivar' : 'Activar'} {table === 'productos' ? 'producto' : table === 'clientes' ? 'cliente' : 'proveedor'}</button>
    {confirm && <ConfirmAction title={active ? 'Desactivar registro' : 'Activar registro'} label={active ? 'Desactivar' : 'Activar'} onClose={() => setConfirm(false)} onConfirm={async () => { const result = await supabase.rpc('desactivar_registro_demo', { tabla: table, id: record.id, desactivar: active }); if (!result.error) { toast(active ? 'Registro desactivado; historial conservado' : 'Registro activado'); onSaved?.() } return result }}>Se conserva su historial. {active ? 'No se podrá seleccionar para nuevas operaciones.' : 'Podrá volver a seleccionarse para nuevas operaciones.'}</ConfirmAction>}
  </>
}
