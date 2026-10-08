import fs from 'node:fs'
const tasks=[['redmi-candidate','https://i02.appmifile.com/mi-com-product/fly-birds/redmi-note-13-pro/pc/a69a4089984da42166ce89df3dc83468.jpg'],['redmi-candidate2','https://i02.appmifile.com/mi-com-product/fly-birds/redmi-note-13-pro/pc/c3a8b5c5d9a588a4fa6f29333ca05f4d.jpg']]
for(const[name,url]of tasks){const r=await fetch(url);fs.writeFileSync('artifacts/'+name+'.jpg',Buffer.from(await r.arrayBuffer()))}
const url='https://www.samsung.com/uk/support/model/SM-R940NZKDWEU/'
const body=await(await fetch(url)).text();fs.writeFileSync('artifacts/watch-uk.html',body);const images=[...new Set(body.match(/(?:https?:)?\/\/[^\s"'<>]+/gi)||[])].filter(x=>/\/is\/image\/.*r940/i.test(x));console.log(JSON.stringify(images.slice(0,7)))
if(images.length){const image=new URL(images.at(-1),url).href;const r=await fetch(image);fs.writeFileSync('src/assets/products/GW6-44.png',Buffer.from(await r.arrayBuffer()));const m=JSON.parse(fs.readFileSync('src/assets/products/sources.json'));m['GW6-44']={source:url,image,filename:'GW6-44.png',provisional:true};fs.writeFileSync('src/assets/products/sources.json',JSON.stringify(m,null,2))}
