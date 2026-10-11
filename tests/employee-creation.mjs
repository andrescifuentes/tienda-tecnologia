import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { normalizeEmployeeInput } from '../supabase/functions/_shared/employee-input.js'
import { createEmployee, loadEmployees } from '../src/lib/employeeCreation.js'
import { createEmployeeHandler, EMPLOYEE_FUNCTION_VERSION } from '../supabase/functions/crear-empleado/handler.ts'

const form = { nombre:'  Nueva Vendedora  ', correo:'  NUEVA@EXAMPLE.COM ', password:'ValidPass123!', telefono:' 3001234567 ', rol:'vendedor', comision_pct:'3', permisos:['vender','ver_inventario','crear_clientes'] }
const normalized = normalizeEmployeeInput(form)
const profile = {id:'new-user',...normalized,activo:true}
delete profile.password
const silent = { error() {} }
const hung = () => new Promise(() => {})
const delay = ms => new Promise(resolve => setTimeout(resolve,ms))
function clientFixture({invoke = async()=>({data:{id:profile.id},error:null}), user = profile, permissionError, permissions = normalized.permisos, listError, listHung=false}={}) {
  const calls=[]
  return {
    calls,
    functions:{invoke:async(...args)=>{calls.push(args);return invoke(...args)}},
    from(table){
      let list=false
      const q={
        select(){return q},eq(){return q},single(){return q},order(){list=true;return q},abortSignal(){return q},
        then(resolve,reject){
          if(list&&listHung)return hung().then(resolve,reject)
          return Promise.resolve(list?{data:[user],error:listError}:table==='perfiles'?{data:user,error:null}:{data:permissions.map(permiso=>({permiso})),error:permissionError}).then(resolve,reject)
        },
      }
      return q
    },
  }
}
const create = (client,input=form,options={}) => createEmployee(client,input,{logger:silent,timeoutMs:80,...options})
async function rejectsCode(action,code) { await assert.rejects(action,e=>e.code===code) }

test('original unbounded invoke remains pending; deadline reproduces and releases the stalled step',async()=>{
  let settled=false
  const original=hung().finally(()=>{settled=true})
  await delay(15);assert.equal(settled,false)
  await rejectsCode(create(clientFixture({invoke:hung}),form,{timeoutMs:20}),'TIMEOUT')
  assert.ok(original)
})
test('normalization preserves password, trims identity, normalizes email and commission',()=>{
  const data=normalizeEmployeeInput({...form,password:' ValidPass123! ',permisos:['vender','vender']})
  assert.equal(data.correo,'nueva@example.com');assert.equal(data.nombre,'Nueva Vendedora')
  assert.equal(data.telefono,'3001234567');assert.equal(data.comision_pct,3)
  assert.equal(data.password,' ValidPass123! ');assert.deepEqual(data.permisos,['vender'])
})
for (const [name,patch] of Object.entries({name:{nombre:' '},email:{correo:'invalid'},password:{password:'short'},commission:{comision_pct:'NaN'},highCommission:{comision_pct:101},negativeCommission:{comision_pct:-1},role:{rol:'administrator'},permissions:{permisos:['admin']}})) {
  test('reject invalid '+name+' before invoking backend',async()=>{
    const c=clientFixture();await assert.rejects(create(c,{...form,...patch}));assert.equal(c.calls.length,0)
  })
}
test('document is included only in demo; no nonexistent real-profile field',()=>{
  assert.equal(normalizeEmployeeInput({...form,documento:' 123 '},{demo:true}).documento,'123')
  assert.equal(Object.hasOwn(normalizeEmployeeInput({...form,documento:'123'}),'documento'),false)
})
test('successful response verifies persisted profile and exact seller permissions',async()=>{
  const c=clientFixture();const result=await create(c)
  assert.equal(result.id,profile.id);assert.equal(result.rol,'vendedor');assert.equal(result.activo,true)
  assert.deepEqual(c.calls[0][1].body,normalized)
  assert.ok(c.calls[0][1].signal instanceof AbortSignal)
})
for(const [name,fixture] of Object.entries({missingProfile:{user:null},wrongRole:{user:{...profile,rol:'admin'}},inactive:{user:{...profile,activo:false}},wrongEmail:{user:{...profile,correo:'other@example.com'}},missingPermission:{permissions:['vender']},extraPermission:{permissions:[...normalized.permisos,'ver_finanzas']},permissionsQueryFailure:{permissionError:{code:'42501'}}})){
  test('no false success: '+name,async()=>rejectsCode(create(clientFixture(fixture)),'VERIFICATION_FAILED'))
}
for(const data of [null,{}, {id:''}, {id:1}])test('reject invalid server success '+JSON.stringify(data),async()=>rejectsCode(create(clientFixture({invoke:async()=>({data,error:null})})),'INVALID_RESPONSE'))
test('duplicate email returns actionable error; retry remains possible',async()=>{
  let count=0
  const c=clientFixture({invoke:async()=>++count===1?{data:null,error:{message:'duplicate key correo'}}:{data:{id:profile.id},error:null}})
  await assert.rejects(create(c),/correo ya/);assert.equal((await create(c)).id,profile.id)
})
test('duplicate document is specific',async()=>assert.rejects(create(clientFixture({invoke:async()=>({error:{message:'duplicate key documento'}})})),/documento/))
for(const [status,message] of [[401,/sesi/],[403,/permisos/],[404,/disponible/]]){
  test('SDK HTTP '+status+' error context is parsed',async()=>{
    const error={message:'Edge Function returned a non-2xx status code',context:new Response(JSON.stringify({message:'Rejected'}),{status})}
    await assert.rejects(create(clientFixture({invoke:async()=>({data:null,error})})),message)
  })
}
test('backend stage and partial rollback failure are preserved in UI diagnostics',async()=>{
  const logs=[]
  await assert.rejects(create(clientFixture({invoke:async()=>({data:null,error:{context:new Response(JSON.stringify({error:'La creaci\u00f3n qued\u00f3 incompleta.',code:'ROLLBACK_FAILED',stage:'permisos',uncertain:true}),{status:500})}})}),form,{logger:{error(...a){logs.push(a)}}}),e=>e.code==='ROLLBACK_FAILED'&&e.stage==='permisos'&&e.uncertain)
  assert.ok(!JSON.stringify(logs).includes(form.password))
  assert.ok(!JSON.stringify(logs).includes('example.com'))
})
test('response.json hanging releases through the same overall deadline',async()=>{
  await rejectsCode(create(clientFixture({invoke:async()=>({data:null,error:{context:{json:hung}}})}),form,{timeoutMs:20}),'TIMEOUT')
})
test('SDK token lookup blocked before fetch releases even when AbortSignal alone cannot',async()=>{
  let fetchCalls=0
  const sdk=createClient('https://test.invalid','test-key',{accessToken:hung,global:{fetch:()=>{fetchCalls++;throw Error('Unexpected network')}}})
  await rejectsCode(create(sdk,form,{timeoutMs:20}),'TIMEOUT');assert.equal(fetchCalls,0)
})
test('real SDK hung HTTP response body is bounded without remote traffic',async()=>{
  const sdk=createClient('https://test.invalid','test-key',{accessToken:async()=>'test-token',global:{fetch:async()=>new Response(new ReadableStream({start(){}}),{headers:{'Content-Type':'application/json'}})}})
  await rejectsCode(create(sdk,form,{timeoutMs:20}),'TIMEOUT')
})
test('network rejection and aborted transport never claim success',async()=>{
  await assert.rejects(create(clientFixture({invoke:async()=>{throw new TypeError('Failed to fetch')}})),e=>e.uncertain&&/conexi/.test(e.message))
})
test('slow response succeeds within deadline',async()=>{
  const c=clientFixture({invoke:async()=>{await delay(20);return{data:{id:profile.id},error:null}}})
  assert.equal((await create(c)).id,profile.id)
})
test('list refresh error and hang settle instead of infinite loader',async()=>{
  await rejectsCode(loadEmployees(clientFixture({listError:{code:'42501'}})),'42501')
  await rejectsCode(loadEmployees(clientFixture({listHung:true}),{timeoutMs:20}),'TIMEOUT')
  assert.equal((await loadEmployees(clientFixture())).length,1)
})

function edgeFixture({failure,backendError,hang,role='admin',active=true,missingConfig=false,cleanupFails=false,cleanupHangs=false,createMissing=false}={}){
  const state={users:new Set(['existing']),profiles:new Map(),perms:new Map(),created:0,deleted:[],logs:[],calls:[]}
  const result = async(stage,action) => {
    state.calls.push(stage)
    if(hang===stage)return hung()
    if(failure===stage)return{data:null,error:backendError||{message:stage==='auth'?'A user with this email address has already been registered':'database foreign key failure',code:'23503'}}
    return{data:action?.(),error:null}
  }
  function query(table){
    let op='select',value,whereId
    const q={select(){return q},insert(v){op='insert';value=v;return q},delete(){op='delete';return q},eq(_,id){whereId=id;return q},single(){return q},
      then(resolve,reject){
        let stage=table==='perfiles'?(op==='insert'?'perfil':'autorizacion'):(op==='insert'?'permisos-insert':'permisos-delete')
        return result(stage,()=>{
          if(stage==='autorizacion')return{rol:role,activo:active}
          if(stage==='perfil'){state.profiles.set(value.id,{...value,activo:true});state.perms.set(value.id,['vender','ver_inventario','crear_clientes']);return null}
          if(stage==='permisos-delete'){state.perms.set(whereId,[]);return null}
          for(const p of value)state.perms.get(p.perfil_id).push(p.permiso)
          return null
        }).then(resolve,reject)
      }}
    return q
  }
  const caller={auth:{getUser:()=>result('sesion',()=>({user:{id:'existing'}}))}}
  const admin={from:query,auth:{admin:{
    createUser:args=>result('auth',()=>{state.created++;state.authInput=args;if(createMissing)return{};state.users.add('new-user');return{user:{id:'new-user'}}}),
    deleteUser:async(id)=>{
      state.deleted.push(id)
      if(cleanupHangs)return hung()
      if(cleanupFails)return{error:{message:'cleanup unavailable'}}
      state.users.delete(id);state.profiles.delete(id);state.perms.delete(id);return{error:null}
    },
  }}}
  const handler=createEmployeeHandler({
    createClient:(_,key)=>key==='anon'?caller:admin,
    env:key=>missingConfig?undefined:({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'}[key]),
    logger:{error(...args){state.logs.push(args)}},stageTimeoutMs:20,totalTimeoutMs:120,cleanupTimeoutMs:20,
  })
  const request=(input=form,method='POST')=>handler(new Request('https://test.invalid/function',{method,headers:{Authorization:'Bearer test-token','Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(input)}:{})}))
  return{state,request,handler}
}
test('Edge creates normalized Auth user, profile and exact permissions; no admin-session replacement',async()=>{
  const{request,state}=edgeFixture();const r=await request();assert.equal(r.status,200);assert.equal((await r.json()).id,'new-user')
  assert.equal(state.authInput.email,'nueva@example.com');assert.equal(state.authInput.email_confirm,true)
  assert.equal(state.profiles.get('new-user').rol,'vendedor');assert.deepEqual(state.perms.get('new-user'),normalized.permisos)
  assert.ok(state.users.has('existing'));assert.deepEqual(state.deleted,[])
})
test('Edge preserves explicit empty permission selection after default trigger',async()=>{
  const{request,state}=edgeFixture();assert.equal((await request({...form,permisos:[]})).status,200)
  assert.deepEqual(state.perms.get('new-user'),[])
})
for(const failure of ['perfil','permisos-delete','permisos-insert']){
  test('Edge '+failure+' failure cleans only new Auth/profile/permissions',async()=>{
    const{request,state}=edgeFixture({failure});const r=await request();const data=await r.json()
    assert.ok(r.status>=400);assert.equal(data.rolledBack,true);assert.equal(data.uncertain,false)
    assert.deepEqual(state.deleted,['new-user']);assert.ok(state.users.has('existing'));assert.equal(state.profiles.size,0);assert.equal(state.perms.size,0)
    assert.ok(!JSON.stringify(data).includes('foreign key'))
  })
}
test('Auth duplicate does not delete or modify existing users',async()=>{
  const{request,state}=edgeFixture({failure:'auth'});const r=await request();assert.equal(r.status,409)
  assert.equal((await r.json()).code,'EMAIL_ALREADY_EXISTS');assert.deepEqual(state.deleted,[]);assert.equal(state.created,0)
})
for(const options of [{role:'vendedor'},{active:false}]){
  test('non-admin or inactive cannot create Auth accounts '+JSON.stringify(options),async()=>{
    const{request,state}=edgeFixture(options);assert.equal((await request()).status,403);assert.equal(state.created,0)
  })
}
test('server configuration failure is visible and never uses browser service credentials',async()=>{
  const{request,state}=edgeFixture({missingConfig:true});const r=await request();assert.equal(r.status,500);assert.equal((await r.json()).code,'MISSING_SECRET');assert.equal(state.created,0)
})
test('server validates password before Auth',async()=>{
  const{request,state}=edgeFixture();assert.equal((await request({...form,password:'short'})).status,400);assert.equal(state.created,0)
})
for(const hang of ['sesion','autorizacion','auth','perfil','permisos-delete','permisos-insert']){
  test('Edge '+hang+' hang is bounded and compensates when id known',async()=>{
    const{request,state}=edgeFixture({hang});const r=await request();const body=await r.json();assert.equal(r.status,504);assert.equal(body.code,'TIMEOUT')
    assert.equal(body.rolledBack,['perfil','permisos-delete','permisos-insert'].includes(hang))
    assert.ok(state.users.has('existing'))
  })
}
for(const options of [{cleanupFails:true},{cleanupHangs:true}]){
  test('rollback failure is explicit; no fictional atomic success '+JSON.stringify(options),async()=>{
    const{request,state}=edgeFixture({failure:'perfil',...options});const r=await request();assert.equal(r.status,500)
    const body=await r.json();assert.equal(body.code,'ROLLBACK_FAILED');assert.equal(body.uncertain,true)
    assert.deepEqual(state.deleted,['new-user']);assert.ok(state.logs.some(log=>log[1]?.stage==='rollback'))
  })
}
test('Edge CORS, method and malformed body fail safely',async()=>{
  const{request}=edgeFixture();const options=await request(form,'OPTIONS');assert.equal(options.status,200);assert.ok(options.headers.get('Access-Control-Allow-Methods').includes('POST'))
  assert.equal((await request(form,'GET')).status,405)
  assert.equal((await request(null)).status,400)
})

test('real SDK HTTP contract -> existing Edge handler -> Auth/profile/permissions -> persisted verification',async()=>{
  const fixture=edgeFixture(), requests=[]
  const sdk=createClient('https://test.invalid','test-key',{
    accessToken:async()=>'administrator-token',
    global:{fetch:async(url,init)=>{
      const request=new Request(url,init),path=new URL(request.url).pathname
      requests.push({path,authorization:request.headers.get('Authorization')})
      if(path==='/functions/v1/crear-empleado')return fixture.handler(request)
      if(path==='/rest/v1/perfiles')return new Response(JSON.stringify(fixture.state.profiles.get('new-user')),{headers:{'Content-Type':'application/json'}})
      if(path==='/rest/v1/perfil_permisos')return new Response(JSON.stringify(fixture.state.perms.get('new-user').map(permiso=>({permiso}))),{headers:{'Content-Type':'application/json'}})
      throw Error('Unexpected request')
    }},
  })
  const result=await create(sdk,form,{timeoutMs:1000})
  assert.equal(result.rol,'vendedor');assert.equal(result.correo,'nueva@example.com')
  assert.equal(fixture.state.created,1)
  assert.deepEqual(requests.map(r=>r.path).sort(),['/functions/v1/crear-empleado','/rest/v1/perfil_permisos','/rest/v1/perfiles'])
  assert.ok(requests.every(r=>r.authorization==='Bearer administrator-token'))
  assert.ok(!requests.some(r=>r.path.includes('/auth/v1/signup')))
})
test('real SDK HTTP partial-permission failure surfaces rollback, never success',async()=>{
  const fixture=edgeFixture({failure:'permisos-insert'})
  const sdk=createClient('https://test.invalid','test-key',{
    accessToken:async()=>'administrator-token',
    global:{fetch:async(url,init)=>fixture.handler(new Request(url,init))},
  })
  await assert.rejects(create(sdk,form,{timeoutMs:1000}),e=>e.stage==='permisos'&&e.code==='FOREIGN_KEY_VIOLATION'&&!e.uncertain)
  assert.deepEqual(fixture.state.deleted,['new-user']);assert.equal(fixture.state.profiles.size,0)
})

test('physical-message regression: SDK FunctionsFetchError is not mislabeled backend rejection',async()=>{
  const logs=[]
  const sdk=createClient('https://test.invalid','test-key',{
    accessToken:async()=>'administrator-token',
    global:{fetch:async()=>{throw new TypeError('Failed to fetch')}},
  })
  await assert.rejects(create(sdk,form,{timeoutMs:1000,logger:{error(...args){logs.push(args)}}}),e=>e.code==='FUNCTION_REQUEST_FAILED'&&e.stage==='conexion'&&e.message.includes('CORS')&&!e.message.includes('backend rechaz'))
  assert.equal(logs[0][1].code,'FUNCTION_REQUEST_FAILED')
})
test('remote NOT_FOUND JSON is recognized even without exposed HTTP status',async()=>{
  await assert.rejects(create(clientFixture({invoke:async()=>({data:{error:'Requested function was not found',code:'NOT_FOUND'},error:null})})),e=>e.code==='FUNCTION_NOT_FOUND'&&e.stage==='gateway'&&e.message.includes('[FUNCTION_NOT_FOUND]'))
})
test('real SDK HTTP 404 preserves gateway code and request id safely',async()=>{
  const requestId='01a12c4c-8ef1-7268-a5d7-1eeb15d1e7d7'
  const sdk=createClient('https://test.invalid','test-key',{
    accessToken:async()=>'administrator-token',
    global:{fetch:async()=>new Response(JSON.stringify({code:'NOT_FOUND',message:'Requested function was not found'}),{status:404,headers:{'content-type':'application/json','sb-request-id':requestId}})},
  })
  await assert.rejects(create(sdk,form,{timeoutMs:1000}),e=>e.code==='FUNCTION_NOT_FOUND'&&e.status===404&&e.requestId===requestId)
})
test('BOOT_ERROR identifies function startup rather than Auth or business rejection',async()=>{
  await assert.rejects(create(clientFixture({invoke:async()=>({data:null,error:{context:new Response(JSON.stringify({code:'BOOT_ERROR',message:'Function failed to start'}),{status:503})}})})),e=>e.code==='BOOT_ERROR'&&e.stage==='inicio')
})
for(const [stage,error,expected] of [
 ['auth',{message:'User not allowed',code:'not_admin'},'AUTH_CREATE_FAILED'],
 ['perfil',{message:'null value in column private@example.com secret-input',code:'23502'},'PROFILE_INSERT_FAILED'],
 ['permisos-insert',{message:'Database unavailable',code:'PGRST001'},'ROLE_ASSIGN_FAILED'],
 ['perfil',{message:'Insufficient privilege',code:'42501'},'RLS_DENIED'],
 ['perfil',{message:'violates foreign key constraint',code:'23503'},'FOREIGN_KEY_VIOLATION'],
]){
  test('specific safe backend code '+expected,async()=>{
    const{request,state}=edgeFixture({failure:stage,backendError:error});const response=await request()
    const body=await response.json();assert.equal(body.code,expected);assert.equal(body.functionVersion,EMPLOYEE_FUNCTION_VERSION)
    assert.match(body.requestId,/^[a-f0-9-]{36}$/)
    assert.equal(response.headers.get('x-angie-function-version'),EMPLOYEE_FUNCTION_VERSION)
    assert.equal(response.headers.get('x-angie-request-id'),body.requestId)
    assert.ok(!JSON.stringify(body).includes('private@example.com'));assert.ok(!JSON.stringify(body).includes('secret-input'))
    assert.ok(state.logs.some(log=>log[1]?.backendCode===error.code))
    assert.ok(!JSON.stringify(state.logs).includes(form.password))
  })
}
test('missing-secret diagnostics list required names, never values',async()=>{
  const {request}=edgeFixture({missingConfig:true});const r=await request();const body=await r.json()
  assert.equal(body.code,'MISSING_SECRET')
  assert.deepEqual(body.missingSecrets,['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])
})
