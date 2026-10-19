import { useState } from 'react'
import InvoiceMessageSettings from '../components/InvoiceMessageSettings'
import BusinessSettings from '../components/BusinessSettings'
import AppShell from '../components/AppShell'
import { SettingsRow, ThemeSegments } from '../components/AdminPrimitives'
import ConfirmAction from '../components/ConfirmAction'
import { isDemoMode } from '../lib/supabase'
import { DEMO_PASSWORD } from '../lib/demo/seed'
import { clearImages } from '../lib/demo/images'
import { useAuth } from '../context/AuthContext'
import { toast } from '../lib/toast'
import { supabase } from '../lib/supabase'

export default function Configuracion() {
  const [confirm,setConfirm]=useState(false),[templatesOpen,setTemplatesOpen]=useState(false),[businessOpen,setBusinessOpen]=useState(false)
  const { salir,esAdmin,tienda }=useAuth()
  async function reset() {
    // Commit first: a quota failure must not delete photos referenced by current data.
    await supabase.demo.reset()
    for(const key of Object.keys(sessionStorage))if(key.startsWith('angie:cart:'))sessionStorage.removeItem(key)
    await clearImages()
    toast('Datos demo restablecidos')
  }
  return <div className="admin-premium admin-settings"><AppShell title="Configuración" sub="Tu espacio de trabajo">
    <section className="settings-group"><h2 className="admin-group-title">Apariencia</h2><ThemeSegments/></section>
    {esAdmin&&<><section className="settings-group"><h2 className="admin-group-title">Datos de la empresa</h2><div className="settings-panel"><SettingsRow data-setting="empresa" label="Identidad y contacto" value={tienda?.nombre||'Configurar empresa'} onClick={()=>setBusinessOpen(true)}/></div></section><section className="settings-group"><h2 className="admin-group-title">Facturación</h2><div className="settings-panel"><SettingsRow label="Plantillas de mensajes" value="Correo y WhatsApp" onClick={()=>setTemplatesOpen(true)}/><SettingsRow data-setting="factura_pie" label="Pie de factura" value={tienda?.factura_pie} onClick={()=>setBusinessOpen(true)}/></div><p className="admin-hint">Moneda COP · America/Bogota. El consecutivo se conserva automáticamente.</p></section></>}
    {businessOpen&&esAdmin&&<BusinessSettings onClose={()=>setBusinessOpen(false)}/>}
    {templatesOpen&&esAdmin&&<InvoiceMessageSettings onClose={()=>setTemplatesOpen(false)}/>}
    <section className="settings-group"><h2 className="admin-group-title">Preferencias</h2><div className="settings-panel"><SettingsRow label="Cerrar sesión" value="Salir" icon="out" onClick={salir}/></div></section>
    <section className="settings-group"><h2 className="admin-group-title">{isDemoMode?'Demo / datos locales':'Conexión real'}</h2>{isDemoMode?<><details className="admin-local-details"><summary>Demo local · información y acceso</summary><p>Datos ficticios guardados en este navegador. WhatsApp y correo se abren solo si tú lo solicitas.</p><p>Administrador: <b>admin@angietech.demo</b><br/>Contraseña demo: <b>{DEMO_PASSWORD}</b></p></details><p className="admin-hint">Restablecer elimina cambios y fotos subidas, recupera los ejemplos y cierra la sesión. Conserva tu tema.</p>{esAdmin&&<button className="admin-reset" onClick={()=>setConfirm(true)}>Restablecer datos demo</button>}</>:<p className="admin-hint">Estás usando la conexión configurada para tu tienda.</p>}</section>
    {confirm&&<ConfirmAction title="Restablecer demo" label="Restablecer y cerrar sesión" onClose={()=>setConfirm(false)} onConfirm={reset}>Se eliminarán los cambios ficticios y fotos locales de este navegador. No afecta datos remotos.</ConfirmAction>}
  </AppShell></div>
}
