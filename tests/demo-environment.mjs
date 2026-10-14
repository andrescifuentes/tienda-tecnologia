import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { esEntornoDemoPermitido } from '../src/lib/demo/environment.js'
import { hashDemoPassword } from '../src/lib/demo/password.js'
import { createDemoClient } from '../src/lib/demo/client.js'
import { DEMO_PASSWORD, DEMO_KEY } from '../src/lib/demo/seed.js'

let checks = 0
const allowed = [
  'http://localhost:5173','http://LOCALHOST:5173','http://127.0.0.1:5173','http://[::1]:5173',
  'http://192.168.0.16:5173','http://192.168.255.255','http://10.0.0.25:5173','http://10.255.255.255',
  'http://172.16.0.0','http://172.20.10.2:5173','http://172.31.255.255','https://dominio.com',
  'https://dominio-publico.com','https://8.8.8.8',
]
const denied = [
  'http://dominio-publico.com','http://8.8.8.8','http://172.15.255.255','http://172.32.0.0',
  'http://192.169.0.16','http://11.0.0.25','http://127.0.0.2','http://[::2]',
  'http://[fd00::1]','http://192.168.0.16.example.com','http://localhost.example.com',
  'ftp://192.168.0.16','http://169.254.1.1','http://100.64.0.1',
]
for(const url of allowed){assert.equal(esEntornoDemoPermitido(new URL(url)),true,url);checks++}
for(const url of denied){assert.equal(esEntornoDemoPermitido(new URL(url)),false,url);checks++}
for(const hostname of ['192.168.256.1','10.999.0.1','172.016.0.1','192.168.1','192.168.0.1:5173','192.168.0.1.evil','']){
  assert.equal(esEntornoDemoPermitido({hostname,protocol:'http:'}),false,hostname);checks++
}
assert.equal(esEntornoDemoPermitido({hostname:'::1',protocol:'http:'}),true);checks++
assert.equal(esEntornoDemoPermitido(null),false);checks++
const location=new URL('http://192.168.0.16:5173')
const values=['','abc',DEMO_PASSWORD,'Contraseña áéíóú 🔐','x'.repeat(55),'x'.repeat(56),'x'.repeat(63),'x'.repeat(64),'x'.repeat(65),'x'.repeat(1000),randomBytes(512).toString('hex')]
for(const password of values){
  const expected=createHash('sha256').update(password).digest('hex')
  assert.equal(await hashDemoPassword(password,{location,crypto:{}}),expected,'LAN SHA-256 fallback')
  assert.equal(await hashDemoPassword(password,{location}),expected,'Web Crypto SHA-256')
  checks+=2
}
const map=new Map(),storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)}
let client=createDemoClient({storage,location,crypto:{}})
let result=await client.auth.signInWithPassword({email:'admin@angietech.demo',password:DEMO_PASSWORD})
assert.equal(result.error,null);assert.equal(result.data.user.id,'demo-admin');checks++
const before=map.get(DEMO_KEY)
result=await client.auth.signInWithPassword({email:'admin@angietech.demo',password:'incorrecta'})
assert.ok(result.error);assert.equal(map.get(DEMO_KEY),before);checks++
result=await client.functions.invoke('crear-empleado',{body:{nombre:'Camila Ospina',correo:'camila@angietech.demo',password:'ClaveLAN123!',rol:'vendedor',comision_pct:3,permisos:['vender']}})
assert.equal(result.error,null);checks++
result=await client.auth.signInWithPassword({email:'camila@angietech.demo',password:'ClaveLAN123!'})
assert.equal(result.error,null);checks++
client=createDemoClient({storage,location,crypto:{}})
assert.equal((await client.auth.getSession()).data.session.user.email,'camila@angietech.demo');checks++
const stored=map.get(DEMO_KEY)
for(const url of denied.filter(url=>url.startsWith('http:'))){
  const publicClient=createDemoClient({storage,location:new URL(url)})
  assert.ok((await publicClient.auth.signInWithPassword({email:'admin@angietech.demo',password:DEMO_PASSWORD})).error)
  assert.ok((await publicClient.auth.getSession()).error,'Block already persisted sessions on public HTTP')
  assert.ok((await publicClient.from('productos').select('*')).error)
  assert.throws(()=>publicClient.demo.reset(),/HTTP públicos/)
  assert.equal(map.get(DEMO_KEY),stored)
  checks++
}
await assert.rejects(hashDemoPassword(DEMO_PASSWORD,{location:new URL('http://dominio-publico.com'),crypto:{}}),/HTTP públicos/);checks++
console.log(`PASS ${checks} demo host, SHA-256, LAN login, employee and public HTTP protection checks`)
