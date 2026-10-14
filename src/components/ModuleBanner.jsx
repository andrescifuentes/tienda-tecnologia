import inicioL from '../assets/banners/inicio-light.webp'
import inicioD from '../assets/banners/inicio-dark.webp'
import venderL from '../assets/banners/vender-light.webp'
import venderD from '../assets/banners/vender-dark.webp'
import productosL from '../assets/banners/productos-light.webp'
import productosD from '../assets/banners/productos-dark.webp'
import facturasL from '../assets/banners/facturas-light.webp'
import facturasD from '../assets/banners/facturas-dark.webp'
import clientesL from '../assets/banners/clientes-light.webp'
import clientesD from '../assets/banners/clientes-dark.webp'
import masL from '../assets/banners/mas-light.webp'
import masD from '../assets/banners/mas-dark.webp'
import adminL from '../assets/banners/inicio-admin-light.webp'
import adminD from '../assets/banners/inicio-admin-dark.webp'
import vendL from '../assets/banners/inicio-vendedor-light.webp'
import vendD from '../assets/banners/inicio-vendedor-dark.webp'

const ARTE = {
  inicio: [inicioL, inicioD], vender: [venderL, venderD], productos: [productosL, productosD],
  facturas: [facturasL, facturasD], clientes: [clientesL, clientesD], mas: [masL, masD],
  'inicio-admin': [adminL, adminD], 'inicio-vendedor': [vendL, vendD],
}

// Encabezado de módulo: título y acciones son componentes reales; la imagen es solo decoración.
// variant 'home' = banner destacado de Inicio; 'inner' = encabezado compacto de pantallas internas.
export default function ModuleBanner({ modulo, title, sub, eyebrow, tagline, actions, variant = 'inner', children }) {
  const arte = ARTE[modulo]
  return <section className={'mb mb-' + variant + ' mb-' + modulo}>
    {arte && <span className="mb-art" aria-hidden="true" style={{ '--mb-l': `url(${arte[0]})`, '--mb-d': `url(${arte[1]})` }} />}
    <span className="mb-wave" aria-hidden="true" />
    <div className="mb-txt">
      {eyebrow && <span className="mb-eyebrow">{eyebrow}</span>}
      <h1 className="mb-title">{title}</h1>
      {tagline && <p className="mb-tagline">{tagline}</p>}
      {sub && <p className="mb-sub">{sub}</p>}
      {children}
      {actions && <div className="mb-actions">{actions}</div>}
    </div>
  </section>
}
