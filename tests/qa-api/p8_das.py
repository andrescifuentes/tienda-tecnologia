from lib import *
S=tokens(); at,vt,bt=S['at'],S['vt'],S['bt']; pa,pb=S['pa'],S['pb']
from datetime import datetime, timedelta, timezone
hoy=(datetime.now(timezone.utc)-timedelta(hours=5)).date(); mes=hoy.replace(day=1)
R=req('POST','/rest/v1/rpc/resumen_dashboard',at,{})[1][0]
fn=req('GET','/rest/v1/facturas_netas?select=fecha,estado,total_neto,costo_neto,vendedor_id&limit=10000',at)[1]
def d(x): return (datetime.strptime(x['fecha'][:19],'%Y-%m-%dT%H:%M:%S')-timedelta(hours=5)).date()
em=[x for x in fn if x['estado']=='emitida']
vh=sum(x['total_neto'] for x in em if d(x)==hoy); ch=sum(1 for x in em if d(x)==hoy)
vm=sum(x['total_neto'] for x in em if d(x)>=mes); cm=sum(1 for x in em if d(x)>=mes)
an=sum(1 for x in fn if x['estado']=='anulada' and d(x)>=mes)
rec('DAS-001', int(R['ventas_hoy'])==int(vh) and R['facturas_hoy']==ch, f'Dashboard hoy {R["ventas_hoy"]} / {R["facturas_hoy"]} facturas = recálculo {int(vh)} / {ch} (solo emitidas, neto de devoluciones)', 'resumen_dashboard vs facturas_netas')
va=sum(x['total_neto'] for x in em if d(x).year==hoy.year)
rec('DAS-002', int(R['ventas_mes'])==int(vm), f'Mes {int(vm)} ({cm} fact.), año {int(va)}; dashboard mes {R["ventas_mes"]}', 'Recálculo por período')
rec('DAS-007', R['facturas_mes']==cm, f'Contador del mes {R["facturas_mes"]} = {cm} emitidas (excluye {an} anuladas)', '')
pr=req('GET','/rest/v1/productos?select=stock,precio_compra,stock_min,activo&activo=eq.true',at)[1]
vi=sum(p['stock']*p['precio_compra'] for p in pr); sbj=sum(1 for p in pr if p['stock']<=p['stock_min'])
rec('DAS-004', int(R['valor_inventario'])==vi, f'Valor inventario {R["valor_inventario"]} = Σ costo × stock ({vi})', 'Fórmula costo × stock de productos activos')
rec('DAS-005', R['productos_stock_bajo']==sbj, f'{R["productos_stock_bajo"]} productos con stock ≤ mínimo (recálculo {sbj})', 'vista stock_bajo')
c,m1=req('POST','/rest/v1/movimientos',at,{'tipo':'ingreso','categoria':'QA','descripcion':'QA prueba','monto':7000,'registrado_por':S['aid']},'return=representation')
c2,m2=req('POST','/rest/v1/movimientos',at,{'tipo':'gasto','categoria':'QA','descripcion':'QA prueba','monto':3000,'registrado_por':S['aid']},'return=representation')
R2=req('POST','/rest/v1/rpc/resumen_dashboard',at,{})[1][0]
di=int(R2['ingresos_mes'])-int(R['ingresos_mes']); dg=int(R2['gastos_mes'])-int(R['gastos_mes']); dv=int(R2['ventas_mes'])-int(R['ventas_mes'])
for m in (m1,m2): req('DELETE',f'/rest/v1/movimientos?id=eq.{m[0]["id"]}',at)
rec('DAS-003', di==7000 and dg==3000 and dv==0, f'Ingreso 7.000 → ingresos +{di}; gasto 3.000 → gastos +{dg}; ventas sin cambio (+{dv}). Movimientos QA eliminados.', 'resumen_dashboard')
ve=req('POST','/rest/v1/rpc/ventas_por_empleado',at,{'p_desde':str(mes),'p_hasta':str(hoy)})[1]
calc={}
for x in em:
    if d(x)>=mes: calc[x['vendedor_id']]=calc.get(x['vendedor_id'],0)+x['total_neto']
ok=all(int(v['total_vendido'])==int(calc.get(v['vendedor_id'],0)) for v in ve)
txt='; '.join(f'{v["nombre"]}: {v["total_vendido"]} ({v["facturas"]} fact.)' for v in ve)
rec('DAS-006', ok, txt+' = recálculo por vendedor', 'rpc ventas_por_empleado')
rec('EMP-004', ok, txt, '')
# permisos
bid=S['bid']
c0,e0=req('POST','/rest/v1/rpc/ajustar_inventario',bt,{'p_producto_id':pb,'p_cantidad':1,'p_tipo':'ajuste_entrada','p_motivo':'QA permiso'})
req('POST','/rest/v1/perfil_permisos',at,{'perfil_id':bid,'permiso':'editar_inventario'})
c1,e1=req('POST','/rest/v1/rpc/ajustar_inventario',bt,{'p_producto_id':pb,'p_cantidad':1,'p_tipo':'ajuste_entrada','p_motivo':'QA permiso'})
req('DELETE',f'/rest/v1/perfil_permisos?perfil_id=eq.{bid}&permiso=eq.editar_inventario',at)
c2,e2=req('POST','/rest/v1/rpc/ajustar_inventario',bt,{'p_producto_id':pb,'p_cantidad':1,'p_tipo':'ajuste_salida','p_motivo':'QA permiso'})
rec('EMP-003', c0>=400 and c1==200 and c2>=400, f'Sin permiso → «{e0}»; al otorgar «Modificar inventario» → OK (mov {e1}); al quitarlo → rechazado otra vez', 'perfil_permisos + tiene_permiso()')
if c1==200: req('POST','/rest/v1/rpc/ajustar_inventario',at,{'p_producto_id':pb,'p_cantidad':1,'p_tipo':'ajuste_salida','p_motivo':'QA revertir permiso'})
ac=req('GET',f'/rest/v1/actividad?select=accion,perfil_id,fecha&fecha=gte.{hoy}T00:00:00&order=id.desc&limit=200',at)[1]
acc=sorted(set(a['accion'] for a in ac))
rec('EMP-008', all(a['perfil_id'] for a in ac[:50]) and 'factura.anulada' in acc and 'productos.update' in acc, f'{len(ac)} registros hoy con actor y fecha; acciones: {", ".join(acc)}', 'tabla actividad (inmutable)')
