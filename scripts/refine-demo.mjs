import fs from 'node:fs'
const path='src/lib/demo/client.js'
let s=fs.readFileSync(path,'utf8')
const original=s
s=s.replace("async function hash(password){const bytes=", "async function hash(password){if(!globalThis.crypto?.subtle)fail('Para acceder a la demo abre la app en localhost o mediante HTTPS.');const bytes=")
s=s.replace("signInWithPassword:async({email,password})=>{const digest=await hash(password);const result=await safe(()=>transaction(state=>", "signInWithPassword:async({email,password})=>{const result=await safe(async()=>{const digest=await hash(password);return transaction(state=>")
s=s.replace("return {session:state.session,user:state.session.user}}));if(!result.error)emit('SIGNED_IN'", "return {session:state.session,user:state.session.user}})});if(!result.error)emit('SIGNED_IN'")
s=s.replace("function move(state, product, count, type, reference, id, cost = product.precio_compra)", "function move(state, product, count, type, reference, id, cost = product.precio_compra, reason = null)")
s=s.replace("referencia_tipo:reference,referencia_id:id,creado_por:","referencia_tipo:reference,referencia_id:id,motivo:reason,creado_por:")
s=s.replace("args.p_tipo,'ajuste',p.id);activity", "args.p_tipo,'ajuste',p.id,p.precio_compra,args.p_motivo.trim());activity")
if(s===original)throw new Error('No expected refinement matched')
fs.writeFileSync(path,s)
