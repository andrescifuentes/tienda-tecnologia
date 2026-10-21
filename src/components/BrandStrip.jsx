import { useEffect, useRef, useState } from 'react'
import { I } from './InvIcons'
import '../styles/team-observations.css'
export default function BrandStrip({brands,value,onChange}) {
 const ref=useRef(null),[edges,setEdges]=useState({start:false,end:false})
 useEffect(()=>{
  const el=ref.current;const sync=()=>setEdges({start:el.scrollLeft>2,end:el.scrollLeft+el.clientWidth<el.scrollWidth-2})
  const chosen=[...el.querySelectorAll('button')].find(b=>b.dataset.brand===value)
  if(chosen){const r=chosen.getBoundingClientRect(),box=el.getBoundingClientRect();if(r.left<box.left)el.scrollLeft-=box.left-r.left+8;else if(r.right>box.right)el.scrollLeft+=r.right-box.right+8}
  sync();el.addEventListener('scroll',sync,{passive:true});const observer=new ResizeObserver(sync);observer.observe(el);return()=>{el.removeEventListener('scroll',sync);observer.disconnect()}
 },[value,brands.length])
 function key(event){const buttons=[...ref.current.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);let next;if(event.key==='ArrowRight')next=Math.min(i+1,buttons.length-1);else if(event.key==='ArrowLeft')next=Math.max(i-1,0);else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;event.preventDefault();const button=buttons[next];button.focus({preventScroll:true});const a=button.getBoundingClientRect(),b=ref.current.getBoundingClientRect();if(a.right>b.right)ref.current.scrollLeft+=a.right-b.right+8;if(a.left<b.left)ref.current.scrollLeft-=b.left-a.left+8}
 return <div className="brand-strip-frame"><div ref={ref} className="brand-strip" role="group" aria-label="Filtrar marcas" onKeyDown={key}>{brands.map(([name,count])=><button type="button" key={name} data-brand={name} aria-pressed={value===name} onClick={()=>onChange(name)}>{name}<small>{count}</small></button>)}</div>{edges.start&&<button type="button" className="brand-strip-arrow prev" aria-label="Marcas anteriores" onClick={()=>ref.current.scrollBy({left:-180,behavior:'smooth'})}><I n="back"/></button>}{edges.end&&<button type="button" className="brand-strip-arrow next" aria-label="Más marcas" onClick={()=>ref.current.scrollBy({left:180,behavior:'smooth'})}><I n="chevDown"/></button>}</div>
}
