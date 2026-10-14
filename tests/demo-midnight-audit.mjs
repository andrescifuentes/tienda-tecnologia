import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createDemoClient } from '../src/lib/demo/client.js'
import { DEMO_PASSWORD, createDemoSeed } from '../src/lib/demo/seed.js'

const evidence=[]
for(const day of ['2026-10-08','2026-11-01'])for(const time of ['00:05','00:30','06:00','12:00','23:50']){
const clock = new Date(`${day}T${time}:00-05:00`)
const records = new Map()
const client = createDemoClient({ storage: {getItem:key=>records.get(key)||null,setItem:(key,value)=>records.set(key,value)}, now:()=>clock, location:{hostname:'localhost',protocol:'http:'} })
const login = await client.auth.signInWithPassword({email:'admin@angietech.demo',password:DEMO_PASSWORD})
assert.equal(login.error,null)
await client.demo.reset()
const seed=createDemoSeed(clock)
for(const [table,rows] of Object.entries(seed.tables))for(const row of rows)if(row.fecha?.includes('T'))assert.ok(new Date(row.fecha)<=clock,`${table} ${row.id} cannot be in the future`)
assert.equal((await client.auth.signInWithPassword({email:'admin@angietech.demo',password:DEMO_PASSWORD})).error,null)
const result = await client.rpc('actualizar_perfil_demo',{nombre:'Administrador auditoría',telefono:'3001234567'})
assert.equal(result.error,null)
const rows = (await client.from('actividad').select('*').order('fecha',{ascending:false})).data
const action = rows.find(row=>row.accion==='Perfil actualizado')
assert.ok(action)
const future = rows.filter(row=>new Date(row.fecha)>clock)
assert.equal(future.length,0)
assert.equal(rows[0].id,action.id)
evidence.push({clock:clock.toISOString(),futureExamples:future.length,newActionIsFirst:true})
}
await mkdir('artifacts/audit-fixes',{recursive:true})
await writeFile('artifacts/audit-fixes/seed.json',JSON.stringify({status:'PASS',cases:evidence.length,evidence},null,2)+'\n')
console.log(`PASS ${evidence.length} seed/reset time checks, including first of month; no future activities and genuine action first`)
