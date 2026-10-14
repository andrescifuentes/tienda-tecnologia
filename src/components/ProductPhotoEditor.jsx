import { useEffect, useRef, useState } from 'react'
import { ProductThumbnail } from './TechVisuals'
import { prepareImage } from '../lib/demo/images'
import { ErrorBox } from './ui'

export default function ProductPhotoEditor({ product, value, onChange, onBusyChange }) {
  const gallery = useRef(null), camera = useRef(null)
  const [preview, setPreview] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!value?.blob) { setPreview(null); return }
    const url = URL.createObjectURL(value.blob); setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [value?.blob])
  async function choose(event) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    setBusy(true); onBusyChange?.(true); setError('')
    try { onChange({ blob: await prepareImage(file), removed: false }) }
    catch (err) { setError(err.message) }
    finally { setBusy(false); onBusyChange?.(false) }
  }
  return <section className="form-section photo-editor"><div className="product-section-heading"><span>02</span><div><h3>Foto del producto</h3><p>Una imagen que identifica tu producto</p></div></div><ErrorBox text={error} />
    <div className="photo-editor-preview">{preview ? <img src={preview} alt="Vista previa de la foto del producto" /> : <ProductThumbnail product={value?.removed ? { ...product, image_ref: null, image_removed: true } : product} />}</div>
    <div className="grid grid-cols-2 gap-2"><button className="btn sec" disabled={busy} onClick={() => gallery.current.click()}>{product?.image_ref || preview ? 'Cambiar foto' : 'Seleccionar foto'}</button><button className="btn sec" disabled={busy} onClick={() => camera.current.click()}>Tomar foto</button></div>
    <input ref={gallery} type="file" accept="image/*" aria-label="Seleccionar foto del producto" className="sr-only" onChange={choose} />
    <input ref={camera} type="file" accept="image/*" capture="environment" aria-label="Tomar foto del producto" className="sr-only" onChange={choose} />
    {(product?.image_ref || product?.id <= 18 || preview) && !value?.removed && <button className="btn sec full mt-2" disabled={busy} onClick={() => onChange({ blob: null, removed: true })}>Eliminar foto</button>}
    <p className="text-xs text-muted">{busy ? 'Preparando fotografía…' : 'Se guarda en este navegador. Si la cámara no está disponible, selecciona una foto de tu galería.'}</p>
  </section>
}
