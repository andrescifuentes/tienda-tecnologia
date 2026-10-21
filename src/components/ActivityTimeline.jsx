import { useNavigate } from 'react-router-dom'
import { Icon } from './Icons'
import { Empty } from './ui'
import '../styles/team-observations.css'
export default function ActivityTimeline({items,onOpen}) {
 const navigate=useNavigate()
 return items.length?<div className="activity-timeline">{items.map(item=><article className={'activity-event '+item.kind} key={item.id}><span className="activity-event-icon"><Icon name={item.icon}/></span><div><h4>{item.title}</h4><p>{item.description}</p><small>{item.date}{item.actor&&' · '+item.actor}</small><footer><span className={item.tone}>{item.estado}</span>{item.to&&<button type="button" onClick={()=>onOpen?onOpen(item):navigate(item.to)}>Ver detalle <span aria-hidden="true">›</span></button>}</footer></div></article>)}</div>:<Empty text="Sin actividad en este período"/>
}
