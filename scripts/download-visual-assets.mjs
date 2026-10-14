import fs from 'node:fs'
const sources={
 'SGS24-256':'https://www.samsung.com/us/smartphones/galaxy-s24/',
 'RN13P-256':'https://www.mi.com/ae-en/product/redmi-note-13-pro/',
 'BUDS-FE':'https://www.samsung.com/us/mobile-audio/galaxy-buds-fe/',
 'GW6-44':'https://www.samsung.com/us/watches/galaxy-watch6/',
 'LIS3-I5':'https://www.lenovo.com/us/en/p/laptops/ideapad/ideapad-300/ideapad-slim-3i-gen-8-(15-inch-intel)/len101i0073',
 'IPAD10-64':'https://support.apple.com/en-us/111840',
 'ANK20K':'https://www.anker.com/products/a1383.js',
 'USBC2M':'https://www.anker.com/products/a8856.js',
 'GLASS15':'https://www.spigen.com/products/iphone-15-series-screen-protector-alignmaster-glas-tr-ez-fit.js',
 'MAGSAFE15':'https://www.spigen.com/products/iphone-15-series-case-ultra-hybrid-magfit.js',
 'HUB7-USBC':'https://www.ugreen.com/products/ugreen-revodok-7-in-1-usb-c-hub.js',
}
const manifest={}
await Promise.all(Object.entries(sources).map(async([code,url])=>{try{
 const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('HTTP '+response.status)
 const body=await response.text();let image
 if(url.endsWith('.js')){const p=JSON.parse(body);image=p.featured_image||p.images?.[0]}
 else image=body.match(/<meta[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)/i)?.[1]||body.match(/<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image/i)?.[1]
 if(!image)throw new Error('No product photograph found');image=new URL(image.replaceAll('&amp;','&'),url).href
 const asset=await fetch(image,{signal:AbortSignal.timeout(20000)});if(!asset.ok||!asset.headers.get('content-type')?.startsWith('image/'))throw new Error('Image unavailable')
 const type=asset.headers.get('content-type'),ext=type.includes('webp')?'webp':type.includes('png')?'png':'jpg'
 fs.writeFileSync(`src/assets/products/${code}.${ext}`,Buffer.from(await asset.arrayBuffer()))
 manifest[code]={source:url,image,filename:`${code}.${ext}`,provisional:true};console.log('DOWNLOADED '+code)
 }catch(e){manifest[code]={source:url,error:e.message};console.log('MISSING '+code+' '+e.message)}}))
fs.writeFileSync('src/assets/products/sources.json',JSON.stringify(manifest,null,2))
for(const [name,url] of Object.entries({PlayfairDisplay:'https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf',Inter:'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf'})){
 const r=await fetch(url);if(!r.ok)throw new Error('Font '+r.status);fs.writeFileSync(`public/fonts/${name}.ttf`,Buffer.from(await r.arrayBuffer()))
 const license=await fetch(url.slice(0,url.lastIndexOf('/'))+'/OFL.txt');fs.writeFileSync(`public/fonts/${name}-OFL.txt`,await license.text());console.log('FONT '+name)
}
