import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import logo from '../assets/brand/angie-tech-logo.png'
import homePhoto from '../assets/photography/home.jpg'
import photoSources from '../assets/products/sources.json'
import { Icon } from './Icons'
import { loadImage } from '../lib/demo/images'

const photos = import.meta.glob('../assets/products/*.{jpg,png,webp}', { eager: true, query: '?url', import: 'default' })
export function productPhoto(product) {
  if (product?.image_removed || product?.image_ref || !product?.id || Number(product.id) > 18) return null
  const filename = photoSources[product?.asset_codigo || product?.codigo]?.filename
  return photos['../assets/products/' + filename] || null
}
export function Brand({ compact = false }) {
  const filterId = 'brand-' + useId().replaceAll(':', '')
  return <div className={'brand-lockup' + (compact ? ' compact' : '')}>
    <svg width="0" height="0" className="brand-filter" aria-hidden="true" focusable="false"><defs><filter id={filterId} colorInterpolationFilters="sRGB">
      <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  .2126 .7152 .0722 0 0" />
      <feComponentTransfer><feFuncA type="table" tableValues="0 0 0 .1 .6 .95 1 1 1 1 1" /></feComponentTransfer>
    </filter></defs></svg>
    <img src={logo} alt="ANGIE TECH" className="brand-logo" style={{ filter: 'url(#' + filterId + ')' }} />
  </div>
}
export function ProductThumbnail({ product }) {
  const [uploaded, setUploaded] = useState(null)
  useEffect(() => {
    let active = true, url
    setUploaded(null)
    if (product?.image_ref) loadImage(product.image_ref).then(blob => { if (active && blob) { url = URL.createObjectURL(blob); setUploaded(url) } }).catch(() => {})
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [product?.image_ref])
  const photo = uploaded || productPhoto(product)
  return <span className="product-thumbnail">{photo ? <img src={photo} alt={product.nombre} loading="lazy" /> : <span className="photo-pending"><b>ANGIE TECH</b>Foto por añadir</span>}</span>
}
export default function TechHero() {
  const ref = useRef(null)
  const navigate = useNavigate()
  useEffect(() => {
    let visible = true
    const pause = () => { if (ref.current) ref.current.dataset.paused = String(!visible || document.hidden) }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; pause() })
    observer.observe(ref.current)
    document.addEventListener('visibilitychange', pause)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', pause) }
  }, [])
  return <section className="tech-hero" ref={ref} aria-label="ANGIE TECH, inicio">
    <img className="hero-photo" src={homePhoto} alt="Dispositivos y accesorios tecnológicos" />
    <div className="hero-copy"><h2>Tecnología<br/>que impulsa<br/>tu <em>negocio.</em></h2><p>Los mejores dispositivos<br/>y accesorios, siempre<br/>al alcance de tu mano.</p><button className="hero-arrow" onClick={() => navigate('/vender')} aria-label="Ir a nueva venta"><Icon name="arrow" /></button></div>
  </section>
}
export function AnimatedCard({ as: Element = 'div', index = 0, className = '', style, children, ...props }) {
  return <Element className={'motion-item ' + className} style={{ ...style, '--entry-delay': Math.min(index, 4) * 35 + 'ms' }} {...props}>{children}</Element>
}

