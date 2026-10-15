import { useEffect, useRef } from 'react'
export default function FitAmount({children,className='',maxSize,minSize=12}) {
 const ref=useRef(null)
 useEffect(()=>{
  const el=ref.current;let last=-1,frame,live=true
  const fit=(force=false)=>{if(!live||!el.clientWidth)return;const width=el.clientWidth;if(!force&&width===last)return;last=width;el.style.fontSize='';const base=maxSize||parseFloat(getComputedStyle(el).fontSize);el.style.fontSize=base+'px';if(el.scrollWidth>width)el.style.fontSize=Math.max(minSize,Math.floor(base*width/el.scrollWidth))+'px'}
  const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>fit())});observer.observe(el);fit(true);document.fonts?.ready.then(()=>fit(true))
  return()=>{live=false;cancelAnimationFrame(frame);observer.disconnect()}
 },[children,maxSize,minSize])
 return <span ref={ref} className={'fit-amount '+className} title={String(children)}>{children}</span>
}
