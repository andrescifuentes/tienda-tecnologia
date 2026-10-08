import fs from 'node:fs'
const manifest=JSON.parse(fs.readFileSync('src/assets/products/sources.json','utf8'))
const urls={
 'BUDS-FE':'https://images.samsung.com/is/image/samsung/p6pim/uk/sm-r400nzaaeua/gallery/uk-galaxy-buds-fe-sm-r400nzaaeua-538543281?$624_468_PNG',
 'ANK20K':'https://cdn.shopify.com/s/files/1/0493/9834/9974/files/A1383011-F0_A1383H11_Product_Image.png?v=1773225296',
 'IPAD10-64':'https://cdsassets.apple.com/live/SZLF0YNV/images/sp/111840_sp884-ipad-10gen-960.png',
 'USBC2M':'https://cdn.shopify.com/s/files/1/0493/9834/9974/files/B8752011_TD01.png?v=1748225373',
 'GLASS15':'https://cdn.shopify.com/s/files/1/0808/0067/files/title_web_ip6.7p_glas_tr_ezfit_02.jpg?v=1724364265',
 'HUB7-USBC':'https://cdn.shopify.com/s/files/1/0257/5246/9566/products/ugreen-7-in-1-4k-hdmi-usb-c-hub-547708.png?v=1694151975',
 'LIS3-I5':'https://p2-ofp.static.pub/fes/cms/2022/12/05/4xmv4q7x8ckr0wctmmh4x1al7k5ly7924347.png',
 'RN13P-256':'https://i02.appmifile.com/mi-com-product/fly-birds/redmi-note-13-pro/pc/91c455e0ce6840776ffe2dbb1240d47c.png',
 'GW6-44':'https://image-us.samsung.com/SamsungUS/home/watches/galaxy-watch6/configurator/7.jpg',
}
await Promise.all(Object.entries(urls).map(async([code,url])=>{try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('HTTP '+r.status);const bytes=Buffer.from(await r.arrayBuffer());if(!['89504e47','ffd8ffe0','ffd8ffe1','ffd8ffdb','52494646'].includes(bytes.subarray(0,4).toString('hex')))throw new Error('Not a photograph');const ext=bytes[0]===137?'png':bytes[0]===82?'webp':'jpg';fs.writeFileSync('src/assets/products/'+code+'.'+ext,bytes);manifest[code]={...manifest[code],image:url,filename:code+'.'+ext,provisional:true};delete manifest[code].error;console.log(code,'OK')}catch(e){console.log(code,e.message)}}))
const budsPage='https://www.samsung.com/uk/audio-sound/galaxy-buds/galaxy-buds-fe-graphite-sm-r400nzaaeua/'
const body=await(await fetch(budsPage,{signal:AbortSignal.timeout(20000)})).text();fs.writeFileSync('artifacts/buds-uk.html',body);const images=[...new Set(body.match(/(?:https?:)?\/\/[^\s"'<>]+?(?:png|jpg)(?:\?[^\s"'<>]*)?/gi)||[])].filter(x=>/r400|buds-fe/i.test(x));console.log('BUDS',JSON.stringify(images.slice(0,12)))
fs.writeFileSync('src/assets/products/sources.json',JSON.stringify(manifest,null,2))
