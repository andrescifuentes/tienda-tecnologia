// Íconos de línea para Inventario (trazo 1.8, esquinas redondeadas)
const P = {
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  dots: <><circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  filter: <path d="M4 7h11M19 7h1M4 12h5M13 12h7M4 17h13M21 17h-0" />,
  sliders: <><path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="17" r="2" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6.5A2.5 2.5 0 0013.5 4h-7A2.5 2.5 0 004 6.5v7A2.5 2.5 0 006.5 16H8" /></>,
  pencil: <path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4zM13.5 6.5l4 4" />,
  cart: <><path d="M3 4h2.2l2.3 11h10.3L20 7.5H6.2" /><circle cx="9" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></>,
  tag: <><path d="M3.5 12.6V4.5a1 1 0 011-1h8.1l8 8a1.4 1.4 0 010 2l-7.1 7.1a1.4 1.4 0 01-2 0l-8-8z" /><circle cx="8" cy="8" r="1.4" /></>,
  palette: <><path d="M12 3.5a8.5 8.5 0 100 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.6 0-.9.7-1.5 1.7-1.5h2.2a3.8 3.8 0 003.8-3.8C20.5 6.6 16.7 3.5 12 3.5z" /><circle cx="7.6" cy="11.5" r="1.1" /><circle cx="9.6" cy="7.6" r="1.1" /><circle cx="14.2" cy="7.4" r="1.1" /></>,
  box: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>,
  warn: <><path d="M12 4l9 16H3l9-16z" /><path d="M12 10v4.5M12 17.5v.01" /></>,
  camera: <><path d="M4 8.5A2.5 2.5 0 016.5 6h1.8l1.5-2h4.4l1.5 2h1.8A2.5 2.5 0 0120 8.5v8A2.5 2.5 0 0117.5 19h-11A2.5 2.5 0 014 16.5v-8z" /><circle cx="12" cy="12.5" r="3.3" /></>,
  chevDown: <path d="M6 9l6 6 6-6" />,
  scan: <path d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16M4 12h16" />,
  barcode: <path d="M4 6v12M7 6v12M10.5 6v12M13 6v12M16.5 6v12M20 6v12" />,
  truck: <><path d="M3 6h11v10H3zM14 9h4l3 3.5V16h-7" /><circle cx="7" cy="17.5" r="1.6" /><circle cx="17.5" cy="17.5" r="1.6" /></>,
  history: <><path d="M4 12a8 8 0 102.4-5.7L4 8.5" /><path d="M4 4v4.5h4.5M12 8v4.5l3 2" /></>,
  adjust: <path d="M12 4v16M5 9l7-5 7 5M5 15l7 5 7-5" />,
  shield: <path d="M12 3.5l7 2.8v5.4c0 4.3-3 7.3-7 8.8-4-1.5-7-4.5-7-8.8V6.3l7-2.8z" />,
  truckIn: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0114 0" /></>,
  trash: <path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" />,
  // categorías
  phone: <><rect x="7" y="2.8" width="10" height="18.4" rx="2.4" /><path d="M11 18h2" /></>,
  case: <><rect x="6.5" y="2.8" width="11" height="18.4" rx="3" /><rect x="8.4" y="4.8" width="3.6" height="3.6" rx="1" /></>,
  charger: <><rect x="6.5" y="9" width="11" height="11.5" rx="2.2" /><path d="M10 9V4M14 9V4M10.5 14.5h3" /></>,
  cable: <path d="M7 3v4M5 7h4v3a2 2 0 01-2 2v0a2 2 0 01-2-2V7zM7 12v3.5a4.5 4.5 0 009 0V9a3 3 0 016 0v0M17 21v-4M15 17h4v-2a2 2 0 00-4 0v2z" />,
  headphones: <><path d="M4 15v-2a8 8 0 0116 0v2" /><rect x="3.5" y="14" width="4" height="6.5" rx="1.6" /><rect x="16.5" y="14" width="4" height="6.5" rx="1.6" /></>,
  glass: <><rect x="6.5" y="2.8" width="11" height="18.4" rx="2.4" /><path d="M9 8.5l6-3M9 13l6-3" /></>,
  laptop: <><rect x="5" y="5" width="14" height="10" rx="1.5" /><path d="M2.5 18.5h19" /></>,
  tv: <><rect x="3" y="5" width="18" height="11.5" rx="1.8" /><path d="M9 20h6M12 16.5V20" /></>,
  gamepad: <><path d="M7 8h10a4 4 0 014 4.3l-.4 3.4a2.4 2.4 0 01-4.2 1.3L15 15.5H9l-1.4 1.5a2.4 2.4 0 01-4.2-1.3L3 12.3A4 4 0 017 8z" /><path d="M8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01" /></>,
  watch: <><rect x="7" y="7" width="10" height="10" rx="2.5" /><path d="M9 7l.7-3.5h4.6L15 7M9 17l.7 3.5h4.6L15 17" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><path d="M4 7l8 6 8-6" /></>,
  chat: <><path d="M4.5 19.5l1.2-3.6A7.8 7.8 0 1112 19.8a7.7 7.7 0 01-3.9-1z" /><path d="M9.2 9.3c.3 2.4 2 4.2 4.6 5l1-1.1-1.6-.9-.7.6c-.8-.4-1.5-1.1-1.9-1.9l.6-.7-.8-1.6z" /></>,
  pin: <><path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 10-13 0c0 5.4 6.5 11 6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  idcard: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><circle cx="8.5" cy="11" r="2" /><path d="M5.8 15.6c.5-1.3 1.5-2 2.7-2s2.2.7 2.7 2M14 10h4M14 13.5h3" /></>,
  receipt: <><path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" /><path d="M9 8h6M9 11.5h6M9 15h3.5" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><path d="M15.5 5.6a3 3 0 010 5.8M17 14.6c1.8.5 3 1.9 3.5 4.4" /></>,
  generic: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>,
}
export function I({ n, className = '', ...rest }) {
  return <svg className={'inv-i ' + className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{P[n] || P.generic}</svg>
}
export function categoryIconName(nombre = '') {
  const c = String(nombre).toLowerCase()
  if (/funda|case|estuche/.test(c)) return 'case'
  if (/celular|tel[eé]fono|smartphone/.test(c)) return 'phone'
  if (/cargador|adaptador/.test(c)) return 'charger'
  if (/cable/.test(c)) return 'cable'
  if (/aud[ií]fono|auricular|parlante|sonido|audio/.test(c)) return 'headphones'
  if (/vidrio|protector|templado/.test(c)) return 'glass'
  if (/computador|port[aá]til|laptop|tablet/.test(c)) return 'laptop'
  if (/televisor|tv|pantalla/.test(c)) return 'tv'
  if (/gaming|consola|juego/.test(c)) return 'gamepad'
  if (/reloj|watch/.test(c)) return 'watch'
  return 'generic'
}
export const CategoryIcon = ({ categoria, className = '' }) => <I n={categoryIconName(categoria)} className={className} />
