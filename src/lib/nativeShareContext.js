// A native share sheet can return an Escape/click to Safari. It is not a dismissal of our invoice.
const protectedDialogs=new WeakMap()
export function isNativeShareProtected(dialog){const guard=dialog&&protectedDialogs.get(dialog);return !!guard&&(guard.active||Date.now()<guard.until)}
export function preserveNativeShareContext(document=globalThis.document,window=globalThis.window){
 const dialogs=document?.querySelectorAll?.('[data-app-dialog]'),dialog=dialogs?.[dialogs.length-1]
 if(!dialog)return()=>{}
 const body=dialog.querySelector('.sheet-body'),top=body?.scrollTop,left=body?.scrollLeft
 const guard={active:true,until:Infinity};protectedDialogs.set(dialog,guard)
 let leftApp=false,ended=false
 const restore=()=>{if(dialog.isConnected&&body?.isConnected){body.scrollTop=top;body.scrollLeft=left}}
 const leave=()=>{leftApp=true}
 const resume=()=>{if(document.visibilityState!=='hidden'){restore();window?.requestAnimationFrame?.(restore);if(leftApp)release()}}
 const visibility=()=>document.visibilityState==='hidden'?leave():resume()
 function release(){
  if(ended)return;ended=true;guard.active=false;guard.until=Date.now()+700
  restore();window?.requestAnimationFrame?.(restore)
  setTimeout(()=>{window?.removeEventListener('blur',leave);window?.removeEventListener('pagehide',leave);window?.removeEventListener('focus',resume);window?.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',visibility);if(protectedDialogs.get(dialog)===guard)protectedDialogs.delete(dialog)},700)
 }
 window?.addEventListener('blur',leave);window?.addEventListener('pagehide',leave);window?.addEventListener('focus',resume);window?.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',visibility)
 return release
}
