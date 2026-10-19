export const BUSINESS_FIELDS=Object.freeze(['nombre','razon_social','nit','nit_dv','direccion','ciudad','telefono','whatsapp','correo','logo_data_url','factura_pie'])
export const BUSINESS_LIMITS=Object.freeze({nombre:100,razon_social:160,nit:15,nit_dv:1,direccion:200,ciudad:100,telefono:40,whatsapp:40,correo:254,factura_pie:1000,logo_data_url:350000})
export function validateBusinessLogo(value){
 if(value==='')return ''
 if(typeof value!=='string'||value.length>350000)throw Error('El logo debe ser PNG o JPG y ocupar hasta 256 KB.')
 const match=value.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/)
 if(!match||match[2].length%4!==0||Math.floor(match[2].length*3/4)-(match[2].endsWith('==')?2:match[2].endsWith('=')?1:0)>262144)throw Error('El logo debe ser PNG o JPG y ocupar hasta 256 KB.')
 if(match[1]==='png'&&!match[2].startsWith('iVBORw0KGgo'))throw Error('El archivo no contiene un PNG válido.')
 if(match[1]==='jpeg'&&!match[2].startsWith('/9j/'))throw Error('El archivo no contiene un JPG válido.')
 return value
}
export function businessDraft(store={}){
 const draft=Object.fromEntries(BUSINESS_FIELDS.map(key=>[key,typeof store?.[key]==='string'?store[key]:'']))
 const nit=draft.nit.match(/^([\d.\s]+)-(\d)$/)
 if(nit&&!draft.nit_dv){draft.nit=nit[1].replace(/[.\s]/g,'');draft.nit_dv=nit[2]}
 else draft.nit=draft.nit.replace(/[.\s]/g,'')
 return draft
}
export function validateBusinessSettings(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!BUSINESS_FIELDS.includes(key)))throw Error('Revisa los datos de la empresa.')
 const result={}
 for(const key of BUSINESS_FIELDS){const raw=input[key]??'';if(typeof raw!=='string'||raw.length>BUSINESS_LIMITS[key])throw Error('Revisa la longitud del campo '+key+'.');const value=raw.trim();if(key!=='factura_pie'&&/[\r\n\x00-\x1f\x7f]/.test(value))throw Error('Escribe '+key+' en una sola línea.');if(key==='factura_pie'&&/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw Error('Revisa el pie de factura.');result[key]=value}
 if(!result.nombre)throw Error('El nombre comercial es obligatorio.')
 if(result.nit&&!/^\d{5,15}$/.test(result.nit))throw Error('Escribe el NIT sin puntos ni dígito de verificación (5 a 15 números).')
 if(result.nit_dv&&(!/^\d$/.test(result.nit_dv)||!result.nit))throw Error('Revisa el NIT y su dígito de verificación.')
 for(const key of ['telefono','whatsapp'])if(result[key]&&(!/^[+\d() .-]+$/.test(result[key])||!/^\d{7,20}$/.test(result[key].replace(/\D/g,''))))throw Error('Revisa el número de '+(key==='whatsapp'?'WhatsApp':'teléfono')+'.')
 if(result.correo&&!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(result.correo))throw Error('Revisa el correo empresarial.')
 result.logo_data_url=validateBusinessLogo(result.logo_data_url)
 return result
}
export const businessNit=store=>store?.nit?String(store.nit)+(store.nit_dv&&!String(store.nit).endsWith('-'+store.nit_dv)?'-'+store.nit_dv:''):''
export const businessContactLines=store=>[store?.razon_social,businessNit(store)&&'NIT '+businessNit(store),[store?.direccion,store?.ciudad].filter(Boolean).join(', '),store?.telefono&&'Tel. '+store.telefono,store?.whatsapp&&'WhatsApp '+store.whatsapp,store?.correo].filter(Boolean)
