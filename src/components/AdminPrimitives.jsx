import { useEffect, useState } from 'react'
import { Icon } from './Icons'
import { Input, Select } from './ui'
import { getTheme, setTheme } from '../lib/theme'

export function SettingsRow({ label, value, onClick, icon = 'doc', ...props }) {
  return <button type="button" className="settings-row row" onClick={onClick} {...props}><span className="admin-symbol"><Icon name={icon}/></span><span className="settings-label">{label}</span><span className="settings-value">{value || 'Agregar'}</span><span className="admin-chevron" aria-hidden="true">›</span></button>
}
export function FormSection({ number, title, children, collapsible = false, detail }) {
  if (collapsible) return <details className="admin-form-section admin-permissions"><summary className="admin-section-heading">{number&&<span>{number}</span>}<h4>{title}</h4><small>{detail}</small></summary><div className="admin-section-fields">{children}</div></details>
  return <section className="admin-form-section"><div className="admin-section-heading">{number && <span>{number}</span>}<h4>{title}</h4></div><div className="admin-section-fields">{children}</div></section>
}
export function PremiumSwitch({ label, checked, onChange, disabled = false }) {
  return <label className="premium-switch row"><span>{label}</span><span className="switch-control"><input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/><span className="switch-track" aria-hidden="true"/></span></label>
}
export function RoleField({ label, value, onChange }) {
  return <div className="role-field"><Select label={label} value={value} onChange={onChange}><option value="vendedor">Vendedor</option><option value="admin">Administrador</option></Select><p>{value==='admin'?'Acceso administrativo.':'Puede vender y consultar inventario según sus permisos.'}</p></div>
}
export function PasswordField({ value, onChange, generate = false }) {
  const [visible,setVisible] = useState(false)
  const create = () => {
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?'
    const bytes=crypto.getRandomValues(new Uint8Array(16))
    // Rejection sampling avoids bias; plaintext stays only in form state.
    let password=''
    while(password.length<16)for(const byte of crypto.getRandomValues(bytes))if(byte<Math.floor(256/alphabet.length)*alphabet.length&&password.length<16)password+=alphabet[byte%alphabet.length]
    onChange({target:{value:password+'aA7!'}});setVisible(false)
  }
  return <div className="admin-password-field"><Input label="Contraseña inicial" autoComplete="new-password" type={visible?'text':'password'} value={value} onChange={onChange}/><div className="password-actions"><button type="button" className="btn sec sm" aria-pressed={visible} onClick={()=>setVisible(v=>!v)}>{visible?'Ocultar contraseña':'Mostrar contraseña'}</button>{generate&&globalThis.crypto?.getRandomValues&&<button type="button" className="btn sec sm" onClick={create}>Generar contraseña</button>}</div><p className="admin-hint">Mínimo 8 caracteres. Compártela directamente con el nuevo usuario.</p></div>
}
export function ThemeSegments() {
  const [theme,update]=useState(getTheme)
  useEffect(()=>{const sync=()=>update(getTheme());window.addEventListener('app-theme-change',sync);return()=>window.removeEventListener('app-theme-change',sync)},[])
  return <div className="theme-segments" role="group" aria-label="Tema de la aplicación">{[['dark','Oscuro','moon'],['light','Claro','sun']].map(([value,label,icon])=><button type="button" key={value} aria-pressed={theme===value} onClick={()=>setTheme(value)}><Icon name={icon}/>{label}</button>)}</div>
}
