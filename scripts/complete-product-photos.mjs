import fs from 'node:fs'
const pages={
 'RN13P-256':'https://www.mi.com/ae-en/product/redmi-note-13-pro/',
 'BUDS-FE':'https://www.samsung.com/us/mobile-audio/galaxy-buds-fe/',
 'GW6-44':'https://www.samsung.com/us/watches/galaxy-watch6/',
 'LIS3-I5':'https://www.lenovo.com/co/es/p/portatiles/ideapad/ideapad-serie-s/ideapad-slim-3i-gen-8-(15-inch-intel)/82x700bflm',
 'USBC2M':'https://www.anker.com/products/a8752',
 'GLASS15':'https://www.spigen.com/products/iphone-15-series-glas-tr-ez-fit-sensor-protection.js',
 'HUB7-USBC':'https://us.ugreen.com/products.json?limit=250',
}
for(const[code,url]of Object.entries(pages)){try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});const body=await r.text();fs.writeFileSync('artifacts/'+code+'.html',body);if(url.endsWith('.js'))console.log(code,JSON.parse(body).images?.slice(0,3));else if(url.includes('products.json')){const ps=JSON.parse(body).products.filter(p=>/7.in.1/i.test(p.title));console.log(code,JSON.stringify(ps.map(p=>({title:p.title,image:p.images?.[0]?.src,handle:p.handle}))))}else{const urls=[...new Set((body.match(/(?:https?:)?\/\/[^\s"'<>]+?\.(?:png|jpg|webp)(?:\?[^\s"'<>]*)?/gi)||[]))].filter(x=>!/(logo|icon|favicon|payment|footer)/i.test(x));console.log(code,JSON.stringify(urls.slice(0,25)))}}catch(e){console.log(code,e.message)}}
