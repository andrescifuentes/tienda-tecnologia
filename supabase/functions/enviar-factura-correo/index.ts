import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { jsPDF } from 'npm:jspdf@4.2.1'
import { createInvoiceEmailHandler } from './handler.js'
import { renderInvoicePdf } from '../_shared/invoice-pdf-core.js'
import { invoiceLogo } from '../_shared/invoice-logo.js'
const env = (name: string) => Deno.env.get(name)
// No server credentials, sender or provider key ever enter the browser.
const url=env('SUPABASE_URL'), serviceKey=env('SUPABASE_SERVICE_ROLE_KEY')
const client=url&&serviceKey?createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}}):null
Deno.serve(createInvoiceEmailHandler({
 env,
 authenticate:async(req:Request)=>{const token=req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!token||!client)return null;const {data,error}=await client.auth.getUser(token);return error?null:data.user?.id},
 rpc:(name:string,args:Record<string,unknown>)=>{if(!client)throw Error('MISSING_CONFIG');return client.rpc(name,args)},
 renderPdf:async(document:any)=>{const pdf=renderInvoicePdf(document.invoice,document.items,document.tienda,{jsPDF,logo:invoiceLogo});return{bytes:new Uint8Array(await pdf.blob.arrayBuffer())}},
}))
