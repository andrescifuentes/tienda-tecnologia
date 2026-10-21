import {createDemoClient} from '../../src/lib/demo/client.js'
export const isDemoMode=new URL(import.meta.url).searchParams.get('demo')==='1'
export const isInvoiceEmailEnabled=false
export const supabaseConfigurationError=''
export const supabase=createDemoClient()
const from=supabase.from.bind(supabase),rpc=supabase.rpc.bind(supabase)
const netColumns=['id','fecha','estado','vendedor_id','cliente_id','total_neto','costo_neto','comision_neta']
supabase.from=table=>{
 let query=from(table),fields='*',start=0,end=Infinity,one=false
 const proxy=new Proxy({}, {get(_,key){
  if(key==='then')return(resolve,reject)=>{
   const mode=sessionStorage.getItem('finance-test-error'),net=table==='facturas_netas'
   const unknown=net&&fields!=='*'&&fields.split(',').find(f=>!netColumns.includes(f))
   const detailDenied=mode==='invoice-denied'&&table==='facturas'&&one||mode==='purchase-denied'&&['compra_items','pagos_proveedor'].includes(table);const error=detailDenied?{code:'42501',message:'permission denied for '+table}:unknown?{code:'42703',message:'column '+table+'.'+unknown+' does not exist'}:mode==='net-permission'&&net||mode==='core-permission'&&table==='movimientos'?{code:'42501',message:'permission denied for '+table}:mode==='net-missing'&&net?{code:'42P01',message:'relation '+table+' does not exist'}:null
   if(error)return Promise.resolve({data:null,error}).then(resolve,reject)
   return Promise.resolve(query).then(result=>{if(result.error)return result;if(!Array.isArray(result.data))return result;let data=result.data;if(table==='facturas'&&fields==='*')data=data.map(({clientes,perfiles,...row})=>row);if(mode==='net-incomplete'&&net)data=data.filter(row=>row.id!==30);data=data.slice(start,end+1);if(net&&fields!=='*')data=data.map(row=>Object.fromEntries(fields.split(',').map(f=>[f,row[f]])));return{...result,data}}).then(resolve,reject)
  }
  if(key==='range')return(a,b)=>{start=a;end=b;return proxy}
  if(key==='abortSignal')return()=>proxy
  return(...args)=>{if(key==='select')fields=args[0];if(key==='single'||key==='maybeSingle')one=true;query=query[key](...args);return proxy}
 }})
 return proxy
}
supabase.rpc=(name,args)=>rpc(name,args)
export async function conAutorizacionAdmin(){throw Error('No administrator authorization in finance read tests')}
