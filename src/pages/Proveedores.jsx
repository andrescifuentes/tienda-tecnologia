import { useEffect, useMemo, useState } from 'react'
import ModuleBanner from '../components/ModuleBanner'
import AppShell, { ThemeToggle } from '../components/AppShell'
import { monetaryError } from '../lib/money'
import { useSearchParams } from 'react-router-dom'
import CompraDetalle from '../components/CompraDetalle'
import Modal from '../components/Modal'
import RecordStatus from '../components/RecordStatus'
import { useAction } from '../lib/useAction'
import CompraForm from '../components/CompraForm'
import { Brand, AnimatedCard } from '../components/TechVisuals'
import { nombreNegocio } from '../lib/marca'
import { useAuth } from '../context/AuthContext'
import { I } from '../components/InvIcons'
import { Empty, Loader, ErrorBox } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { money, fecha, mensajeError } from '../lib/format'
import { enlaceWhatsApp } from '../lib/whatsapp'
import { toast } from '../lib/toast'

const iniciales = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase()
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const saldoDe = (compras, id) => compras.filter((c) => c.proveedor_id === id && c.saldo > 0).reduce((n, c) => n + Number(c.saldo), 0)

export default function Proveedores() {
  const [params] = useSearchParams()
  const [q, setQ] = useState('')
  const [compras, setCompras] = useState([])
  const [lista, setLista] = useState(null)
  const [form, setForm] = useState(null)
  const [sel, setSel] = useState(null)
  const [tick, setTick] = useState(0)
  const [balances, setBalances] = useState(false)

  useEffect(() => {
    ;(async () => {
      const [p, c] = await Promise.all([
        supabase.from('proveedores').select('*').order('nombre'),
        supabase.from('compras_saldo').select('*').eq('estado', 'recibida'),
      ])
      if (params.get('compra')) { const link = (c.data || []).find((x) => x.id === Number(params.get('compra'))); if (link) setSel((p.data || []).find((x) => x.id === link.proveedor_id)) }
      setLista(p.data || []); setCompras(c.data || [])
    })()
  }, [tick, params])

  const resumen = useMemo(() => {
    const pend = compras.filter((c) => c.saldo > 0)
    const hoy = hoyISO()
    return {
      deuda: pend.reduce((a, c) => a + Number(c.saldo), 0),
      conSaldo: new Set(pend.map((c) => c.proveedor_id)).size,
      vencidas: pend.filter((c) => c.vence_el && String(c.vence_el).slice(0, 10) < hoy).length,
      mes: compras.filter((c) => String(c.fecha || '').slice(0, 7) === hoy.slice(0, 7)).reduce((a, c) => a + Number(c.total || 0), 0),
    }
  }, [compras])
  const visible = (lista || []).filter((p) => [p.nombre, p.contacto, p.telefono, p.nit].some((v) => String(v || '').toLocaleLowerCase().includes(q.toLocaleLowerCase())))
  const refrescar = () => { setLista(null); setTick((t) => t + 1) }

  const header = <div className="inv-head fv-head">
    <div className="inv-head-top"><Brand compact /><ThemeToggle /></div>
    <ModuleBanner modulo="mas" title="Proveedores" sub="Compras y cuentas por pagar" actions={<button type="button" onClick={() => setForm({})}><I n="plus" />Nuevo proveedor</button>} />
  </div>

  return (
    <div className="admin-premium admin-suppliers"><AppShell title="Proveedores" header={header}>
      <button type="button" className={'pv-debt' + (resumen.deuda > 0 ? ' due' : ' ok')} onClick={() => setBalances(true)}>
        <span className="pv-debt-top"><span className="pv-debt-ic"><I n={resumen.deuda > 0 ? 'receipt' : 'check'} /></span><span className="pv-debt-lbl">Cuentas por pagar</span><span className="pv-debt-more">Ver detalle<I n="back" className="flip" /></span></span>
        <b className="pv-debt-total">{money(resumen.deuda)}</b>
        <span className="pv-debt-chips">
          {resumen.deuda > 0 ? <span><i />{resumen.conSaldo} {resumen.conSaldo === 1 ? 'proveedor' : 'proveedores'} con saldo</span> : <span className="good"><i />Todo al día</span>}
          {resumen.vencidas > 0 && <span className="bad"><i />{resumen.vencidas} {resumen.vencidas === 1 ? 'vencida' : 'vencidas'}</span>}
          <span className="soft">Comprado este mes · {money(resumen.mes)}</span>
        </span>
      </button>

      <div className="inv-search">
        <label className="inv-search-box"><I n="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor, NIT o contacto" aria-label="Buscar proveedor" />{q && <button type="button" className="inv-scan" aria-label="Limpiar búsqueda" onClick={() => setQ('')}>✕</button>}</label>
      </div>

      {!lista ? <Loader /> : visible.length === 0 ? (q ? <Empty text="Sin resultados" description="Prueba con otro nombre o NIT." /> : <div className="pv-empty">
          <span className="pv-empty-ic"><I n="truck" /></span>
          <b>Aún no tienes proveedores</b>
          <p>Registra a quienes te surten mercancía para controlar compras, pagos y saldos pendientes.</p>
          <button type="button" className="cf-save" onClick={() => setForm({})}><I n="plus" />Crear primer proveedor</button>
        </div>) : (
        <div className="fv-list">
          {visible.map((p, i) => {
            const saldo = saldoDe(compras, p.id)
            return <AnimatedCard as="button" type="button" index={i} key={p.id} className={'fv-card pv-card' + (p.activo === false ? ' void' : '')} onClick={() => setSel(p)}>
              <span className="fv-avatar">{iniciales(p.nombre)}</span>
              <span className="fv-main">
                <span className="fv-name">{p.nombre}</span>
                <span className="cl-line"><I n="idcard" />{p.nit ? 'NIT ' + p.nit : 'Sin NIT'}</span>
                <span className="fv-seller"><I n="user" />{p.contacto || 'Sin contacto'}{p.telefono ? ' · ' + p.telefono : ''}</span>
              </span>
              <span className="fv-side">
                {saldo > 0 ? <><b className="fv-amount pv-due">{money(saldo)}</b><span className="fv-status warn">Por pagar</span></> : <span className="fv-status good">Al día</span>}
                {p.activo === false && <span className="fv-status bad">Inactivo</span>}
              </span>
            </AnimatedCard>
          })}
        </div>
      )}
      {form && <Form inicial={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); setSel(null); refrescar() }} />}
      {sel && !form && <Detalle compraId={Number(params.get('compra')) || null} p={sel} onClose={() => setSel(null)} onEditar={() => setForm(sel)} onCambio={refrescar} />}
      {balances && <Modal title="Cuentas por pagar" subtitle={`Saldo total ${money(resumen.deuda)}`} className="flt-sheet" onClose={() => setBalances(false)}>
        {resumen.deuda === 0 ? <div className="pv-empty slim"><span className="pv-empty-ic ok"><I n="check" /></span><b>Todos los proveedores están al día</b></div> : <div className="flt-list">
          {(lista || []).filter((p) => saldoDe(compras, p.id) > 0).sort((a, b) => saldoDe(compras, b.id) - saldoDe(compras, a.id)).map((p) => <button key={p.id} type="button" onClick={() => { setBalances(false); setSel(p) }}>
            <span className="flt-row-ic"><b className="pos-brand-letter">{iniciales(p.nombre)}</b></span>
            <span className="flt-row-name">{p.nombre}<small className="flt-row-sub">{compras.filter((c) => c.proveedor_id === p.id && c.saldo > 0).length} compras pendientes</small></span>
            <b className="pv-due">{money(saldoDe(compras, p.id))}</b>
          </button>)}
        </div>}
      </Modal>}
    </AppShell></div>
  )
}

function Form({ inicial, onClose, onSaved }) {
  const [f, setF] = useState({ nombre: '', nit: '', contacto: '', telefono: '', correo: '', direccion: '', ...(inicial || {}) })
  const [err, setErr] = useState('')
  const [mas, setMas] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const [guardar, pendingSave] = useAction(guardarImpl)
  async function guardarImpl() {
    if (!f.nombre.trim()) return setErr('El nombre es obligatorio.')
    const d = { nombre: f.nombre.trim(), nit: f.nit?.trim() || null, contacto: f.contacto?.trim() || null, telefono: f.telefono?.trim() || null, correo: f.correo?.trim() || null, direccion: f.direccion?.trim() || null }
    if (isDemoMode) { d.ciudad = f.ciudad?.trim() || null; d.notas = f.notas?.trim() || null }
    const { error } = inicial?.id ? await supabase.from('proveedores').update(d).eq('id', inicial.id) : await supabase.from('proveedores').insert(d)
    if (error) return setErr(mensajeError(error))
    toast(inicial?.id ? 'Proveedor actualizado' : 'Proveedor creado'); onSaved()
  }
  const campo = (k, label, icon, props = {}) => <label className={'cf-field' + (f[k] ? ' filled' : '')}>
    <span className="cf-label">{label}{props.required && <em>*</em>}</span>
    <span className="cf-box"><span className="cf-ic"><I n={icon} /></span>{props.prefix && <span className="cf-prefix">{props.prefix}</span>}<input value={f[k] || ''} onChange={set(k)} placeholder={props.placeholder} inputMode={props.inputMode} type={props.type || 'text'} autoComplete="off" /></span>
  </label>
  return (
    <Modal title={inicial ? 'Editar proveedor' : 'Nuevo proveedor'} subtitle="Solo lo necesario, el resto es opcional" className="experience-sheet cf-sheet" keyboardAware onClose={onClose} footer={<button className="cf-save" onClick={guardar} disabled={pendingSave}><I n="check" />{pendingSave ? 'Guardando…' : inicial ? 'Guardar cambios' : 'Guardar proveedor'}</button>}>
      <div className="cf-hero">
        <span className={'cf-avatar' + (f.nombre?.trim() ? ' on' : '')}>{iniciales(f.nombre) || <I n="truck" />}</span>
        <span className="cf-hero-txt"><b>{f.nombre?.trim() || 'Nombre del proveedor'}</b><small>{f.nit ? 'NIT ' + f.nit : 'NIT sin registrar'}</small></span>
      </div>
      <ErrorBox text={err} />
      {campo('nombre', 'Nombre del proveedor', 'truck', { required: true, placeholder: 'Ej. Distribuidora Tech' })}
      {campo('telefono', 'WhatsApp', 'chat', { inputMode: 'tel', prefix: '+57', placeholder: '300 123 4567' })}
      {campo('correo', 'Correo', 'mail', { type: 'email', inputMode: 'email', placeholder: 'ventas@proveedor.com' })}
      {mas || f.nit || f.direccion || f.contacto ? <>
        {campo('nit', 'NIT', 'idcard', { inputMode: 'numeric', placeholder: 'Opcional' })}
        {campo('contacto', 'Persona de contacto', 'user', { placeholder: 'Opcional' })}
        {campo('direccion', 'Dirección', 'pin', { placeholder: 'Opcional' })}
      </> : <button type="button" className="pos-more" onClick={() => setMas(true)}><I n="plus" />Agregar NIT u otros datos</button>}
    </Modal>
  )
}

function Detalle({ compraId, p, onClose, onEditar, onCambio }) {
  const { tienda } = useAuth() || {}
  const [seePurchase, setSeePurchase] = useState(null)
  useEffect(() => { setSeePurchase(compraId || null) }, [compraId])
  const [compras, setCompras] = useState(null)
  const [prods, setProds] = useState(null)
  const [pagar, setPagar] = useState(null)
  const [monto, setMonto] = useState('')
  const [err, setErr] = useState('')
  const [nueva, setNueva] = useState(false)
  const cargar = () => {
    supabase.from('compras_saldo').select('*').eq('proveedor_id', p.id).order('fecha', { ascending: false }).limit(30).then(({ data }) => setCompras(data || []))
    supabase.from('productos').select('id,nombre,stock').eq('proveedor_id', p.id).eq('activo', true).order('nombre').then(({ data }) => setProds(data || []))
  }
  useEffect(cargar, [p.id]) // eslint-disable-line

  const [registrarPago, pendingPayment] = useAction(registrarPagoImpl)
  async function registrarPagoImpl() {
    setErr('')
    if (monetaryError(monto)) return setErr(monetaryError(monto))
    const { error } = await supabase.rpc('registrar_pago_proveedor', { p_compra_id: pagar.id, p_monto: Number(monto), p_metodo_pago: 'efectivo' })
    if (error) return setErr(mensajeError(error))
    toast('Pago registrado'); setPagar(null); setMonto(''); cargar(); onCambio()
  }
  const total = (compras || []).reduce((n, c) => n + Number(c.total || 0), 0)
  const saldo = (compras || []).filter((c) => c.saldo > 0).reduce((n, c) => n + Number(c.saldo), 0)
  const tel = String(p.telefono || '').replace(/\D/g, '')
  const hoy = hoyISO()

  return (
    <Modal title="Proveedor" className="experience-sheet fd-sheet pv-sheet" keyboardAware onClose={onClose} footer={<div className="pv-foot"><button type="button" className="inv-btn-outline" onClick={onEditar}><I n="pencil" />Editar</button><button type="button" className="inv-btn-gold" disabled={p.activo === false} onClick={() => setNueva(true)}><I n="truckIn" />Registrar compra</button></div>}>
      <ErrorBox text={err} />
      <section className="cl-hero">
        <span className="cl-hero-avatar">{iniciales(p.nombre)}</span>
        <h2>{p.nombre}</h2>
        <p>{p.activo === false && <em className="cl-tier off">Inactivo</em>}<span>{[p.nit && 'NIT ' + p.nit, p.contacto].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</span></p>
        <div className="cl-actions">
          <a className={'cl-act' + (tel ? '' : ' off')} href={tel ? 'tel:' + tel : undefined}><I n="phone" /><span>Llamar</span></a>
          <a className={'cl-act' + (tel ? '' : ' off')} href={tel ? enlaceWhatsApp(tel, `Hola${p.contacto ? ' ' + p.contacto.split(' ')[0] : ''}, te escribimos de ${nombreNegocio(tienda).toUpperCase()}.`) : undefined} target="_blank" rel="noreferrer"><I n="chat" /><span>WhatsApp</span></a>
          <a className={'cl-act' + (p.correo ? '' : ' off')} href={p.correo ? 'mailto:' + p.correo : undefined}><I n="mail" /><span>Correo</span></a>
        </div>
      </section>
      {isDemoMode && <RecordStatus table="proveedores" record={p} onSaved={() => { onCambio(); onClose() }} />}

      <section className="cl-tiles">
        <div className={'cl-tile big' + (saldo > 0 ? ' pv-due-tile' : '')}><span>Saldo por pagar</span><b>{compras ? money(saldo) : '—'}</b></div>
        <div className="cl-tile"><span>Total comprado</span><b>{compras ? money(total) : '—'}</b></div>
        <div className="cl-tile"><span>Compras</span><b>{compras ? compras.length : '—'}</b></div>
      </section>

      <h3 className="cl-section">Compras {compras?.length ? <span>{compras.length}</span> : null}</h3>
      {!compras ? <Loader /> : compras.length === 0 ? <p className="cl-empty">Aún no hay compras a este proveedor.</p> : <div className="fv-list">
        {compras.map((c) => {
          const vencida = c.saldo > 0 && c.vence_el && String(c.vence_el).slice(0, 10) < hoy
          return <div key={c.id} className={'pv-buy' + (c.saldo > 0 ? ' due' : '') + (vencida ? ' late' : '')}>
            <button type="button" className="pv-buy-main" onClick={() => setSeePurchase(c.id)}>
              <span className="fv-avatar walkin"><I n="truckIn" /></span>
              <span className="fv-main"><span className="fv-name">{c.numero_documento || 'Compra #' + c.id}</span><span className="fv-seller">{fecha(c.fecha)} · {c.forma_pago}{c.vence_el ? ' · vence ' + fecha(c.vence_el) : ''}</span></span>
              <span className="fv-side"><b className="fv-amount">{money(c.total)}</b>{c.saldo > 0 ? <span className={'fv-status ' + (vencida ? 'bad' : 'warn')}>{vencida ? 'Vencida' : 'Debe ' + money(c.saldo)}</span> : <span className="fv-status good">Pagada</span>}</span>
            </button>
            {c.saldo > 0 && <button type="button" className="pv-pay" onClick={() => { setPagar(c); setMonto(String(c.saldo)) }}><I n="cash" />Pagar {money(c.saldo)}</button>}
          </div>
        })}
      </div>}

      <h3 className="cl-section">Productos que surte {prods?.length ? <span>{prods.length}</span> : null}</h3>
      {!prods ? <Loader /> : prods.length === 0 ? <p className="cl-empty">Sin productos asignados a este proveedor.</p> : <div className="pv-prods">{prods.map((x) => <span key={x.id}><b>{x.nombre}</b><em>{x.stock} uds</em></span>)}</div>}

      {seePurchase && <CompraDetalle id={seePurchase} onClose={() => setSeePurchase(null)} />}
      {pagar && (
        <Modal title="Registrar pago" subtitle={pagar.numero_documento || 'Compra #' + pagar.id} className="experience-sheet cf-sheet" keyboardAware onClose={() => setPagar(null)} footer={<button className="cf-save" disabled={pendingPayment} onClick={registrarPago}><I n="check" />{pendingPayment ? 'Registrando…' : 'Registrar pago'}</button>}>
          <div className="pv-paybox"><span>Saldo pendiente</span><b>{money(pagar.saldo)}</b></div>
          <label className="cf-field filled"><span className="cf-label">Monto a pagar</span><span className="cf-box"><span className="cf-ic"><I n="cash" /></span><span className="cf-prefix">$</span><input type="number" min="1" max={pagar.saldo} inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value)} /></span></label>
          <div className="pv-quick">{[0.25, 0.5, 1].map((k) => <button key={k} type="button" onClick={() => setMonto(String(Math.round(pagar.saldo * k)))}>{k === 1 ? 'Todo' : k * 100 + '%'}</button>)}</div>
        </Modal>
      )}
      {nueva && <CompraForm proveedorId={p.id} onClose={() => setNueva(false)} onSaved={() => { setNueva(false); cargar(); onCambio() }} />}
    </Modal>
  )
}
