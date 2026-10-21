import { useEffect, useState } from 'react'
import Modal from './Modal'
import { I } from './InvIcons'
import { Loader, ErrorBox } from './ui'
import { supabase } from '../lib/supabase'
import { money, mensajeError } from '../lib/format'
import { loadTransferMethods, transferSchemaMissing } from '../lib/transferMethods'
import '../styles/transfer-qr.css'

const iniciales = n => String(n || '').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase()
export const MedioLogo = ({ medio, size = '' }) => <span className={'tqr-logo ' + size}>{medio.logo_data_url ? <img src={medio.logo_data_url} alt="" /> : <b>{iniciales(medio.nombre)}</b>}</span>

// Pantalla de cobro por transferencia: solo muestra los QR que cargó el administrador.
// Elegir un medio no registra el pago; «Pago recibido» usa el mismo cobro seguro de la venta.
export default function TransferenciaQR({ total, selectedId, busy = false, onSelect, onConfirm, onClose }) {
  const [medios, setMedios] = useState(null), [error, setError] = useState(''), [missing, setMissing] = useState(false), [tick, setTick] = useState(0)
  const [medio, setMedio] = useState(null), [zoom, setZoom] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setError(''); setMissing(false)
    loadTransferMethods(supabase, { signal: controller.signal }).then(rows => {
      setMedios(rows)
      const preset = rows.find(m => String(m.id) === String(selectedId)) || (rows.length === 1 ? rows[0] : null)
      if (preset) { setMedio(preset); onSelect?.(preset) }
    }).catch(e => { if (controller.signal.aborted) return; setMedios([]); if (transferSchemaMissing(e)) setMissing(true); else setError(mensajeError(e)) })
    return () => controller.abort()
  }, [tick]) // eslint-disable-line
  const elegir = m => { setMedio(m); setZoom(false); onSelect?.(m) }
  const volver = () => { setMedio(null); setZoom(false); onSelect?.(null) }

  const footer = medio
    ? <div className="tqr-foot">
        {medios?.length > 1 && <button type="button" className="inv-btn-outline" disabled={busy} onClick={volver}><I n="back" />Otro medio</button>}
        <button type="button" className="inv-btn-gold" disabled={busy} onClick={() => onConfirm(medio)}><I n="check" />{busy ? 'Procesando…' : 'Pago recibido · Cobrar ' + money(total)}</button>
      </div>
    : <button type="button" className="inv-btn-outline full" onClick={onClose}>Volver a la venta</button>

  return <Modal title={medio ? 'Pagar con ' + medio.nombre : 'Pago por transferencia'} subtitle={medio ? 'Muestra este código al cliente' : 'Elige dónde va a transferir el cliente'} className="experience-sheet tqr-sheet" onClose={() => { if (!busy) onClose() }} footer={footer}>
    <ErrorBox text={error} />
    {error && <button type="button" className="btn sec full" onClick={() => setTick(t => t + 1)}>Reintentar</button>}
    {!medio && <div className="tqr-amount"><span>Valor a pagar</span><b>{money(total)}</b></div>}
    {medios === null ? <Loader filas={3} /> : missing ? <div className="tqr-empty"><span className="tqr-empty-ic"><I n="warn" /></span><b>Códigos QR pendientes de activación</b><p>La base de datos aún no tiene los medios de transferencia (script 16). Puedes cobrar por transferencia como antes; confirma el pago en el celular del negocio.</p></div>
      : !medio && medios.length === 0 ? <div className="tqr-empty"><span className="tqr-empty-ic"><I n="bank" /></span><b>Sin códigos QR configurados</b><p>El administrador puede agregarlos en Configuración → Métodos de pago. Puedes cobrar por transferencia confirmando el pago con el cliente.</p></div>
      : !medio ? <div className="tqr-list">{medios.map(m => <button type="button" key={m.id} className="tqr-option" onClick={() => elegir(m)}>
          <MedioLogo medio={m} />
          <span className="tqr-option-txt"><b>{m.nombre}</b><small>{[m.titular, m.numero_cuenta].filter(Boolean).join(' · ') || 'Código QR'}</small></span>
          <span className="tqr-go">Ver QR<I n="back" className="flip" /></span>
        </button>)}</div>
      : <section className="tqr-pay">
          <div className="tqr-brand"><MedioLogo medio={medio} size="lg" /><span><small>Transferir a</small><b>{medio.nombre}</b></span></div>
          <button type="button" className={'tqr-code' + (zoom ? ' zoom' : '')} onClick={() => setZoom(z => !z)} aria-label={zoom ? 'Reducir código QR' : 'Ampliar código QR'}>
            <img src={medio.qr_data_url} alt={'Código QR de ' + medio.nombre} />
          </button>
          <small className="tqr-hint">{zoom ? 'Toca para reducir' : 'Toca el código para ampliarlo'} · sube el brillo si el cliente no lo lee</small>
          <div className="tqr-total"><span>Valor a pagar</span><b>{money(total)}</b></div>
          {(medio.titular || medio.numero_cuenta || medio.detalle) && <dl className="tqr-info">
            {medio.titular && <div><dt>Titular</dt><dd>{medio.titular}</dd></div>}
            {medio.numero_cuenta && <div><dt>Cuenta / número</dt><dd className="mono">{medio.numero_cuenta}</dd></div>}
            {medio.detalle && <div><dt>Detalle</dt><dd>{medio.detalle}</dd></div>}
          </dl>}
          <p className="tqr-note"><I n="warn" />Mostrar el código no registra el pago. Confirma solo cuando veas la transferencia recibida.</p>
        </section>}
  </Modal>
}
