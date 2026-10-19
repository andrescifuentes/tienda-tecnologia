from lib import *
s,a=login('admin@prueba.com','Admin12345'); rec('AUT-001', s==200 and 'access_token' in a, f'HTTP {s}, sesión emitida para {a.get("user",{}).get("email")}', 'API auth/v1/token')
s,v=login('vendedor@prueba.com','Vendedor12345'); rec('AUT-002', s==200 and 'access_token' in v, f'HTTP {s}, sesión emitida para {v.get("user",{}).get("email")}', 'API auth/v1/token')
s,x=login('vendedor@prueba.com','ClaveMala999'); rec('AUT-003', s==400 and 'access_token' not in str(x), f'HTTP {s}: {x}; UI traduce a «Correo o contraseña incorrectos.»', 'mensajeError() en format.js')
S=tokens(); at,vt=S['at'],S['vt']
# AUT-006 / EMP-007
ok=True; det=[]
for t in ['movimientos','compras','pagos_proveedor','actividad','compra_items','movimientos_inventario']:
    c,d=req('GET',f'/rest/v1/{t}?select=*&limit=5',vt); n=len(d) if c==200 and isinstance(d,list) else d
    det.append(f'{t}:{n}'); ok = ok and (c!=200 or d==[])
c,d=req('POST','/rest/v1/rpc/resumen_dashboard',vt,{}); det.append(f'resumen_dashboard:{c}'); ok=ok and c>=400
c,d=req('GET','/rest/v1/productos?select=precio_compra&limit=3',vt); det.append(f'productos(costos):{len(d) if c==200 else c}'); ok=ok and (c!=200 or d==[])
rec('AUT-006', ok, '; '.join(det), 'API REST con token de vendedor')
rec('EMP-007', ok, 'Servidor deniega: '+'; '.join(det), 'Mismo set que AUT-006 + rutas /finanzas /proveedores /empleados redirigen a Inicio')
# AUT-007
c,p=req('GET','/rest/v1/productos_venta?select=id,precio_venta,stock&limit=1',vt); pid=p[0]['id']; pv,st=p[0]['precio_venta'],p[0]['stock']
c1,u1=req('PATCH',f'/rest/v1/productos?id=eq.{pid}',vt,{'precio_venta':1},'return=representation')
c2,u2=req('POST','/rest/v1/rpc/ajustar_inventario',vt,{'p_producto_id':pid,'p_cantidad':5,'p_tipo':'ajuste_entrada','p_motivo':'QA'})
c3,u3=req('PATCH',f'/rest/v1/productos?id=eq.{pid}',vt,{'stock':999},'return=representation')
c,p2=req('GET',f'/rest/v1/productos_venta?select=precio_venta,stock&id=eq.{pid}',vt)
ok = p2[0]['precio_venta']==pv and p2[0]['stock']==st and c2>=400
rec('AUT-007', ok, f'PATCH precio → {c1} filas={u1 if c1>=400 else len(u1)}; ajuste → {c2} «{u2}»; PATCH stock → {c3}; precio y stock intactos ({pv}, {st})', 'UI vendedor sin Editar/Cargar')
rec('INV-013', ok, f'Ajuste por API rechazado: «{u2}»; stock intacto ({st})', 'UI vendedor sin botón Cargar')
# AUT-010 token expirado/ inválido
fake='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4IiwiZXhwIjoxNjAwMDAwMDAwfQ.x'
c,d=req('GET','/rest/v1/facturas?select=id',fake); c2,d2=req('POST','/rest/v1/rpc/emitir_factura',fake,{'p_cliente_id':None,'p_metodo_pago':'efectivo','p_items':[]})
rec('AUT-010', c==401 and c2==401, f'Lectura con token vencido → {c} «{d}»; emitir factura → {c2}', 'supabase-js refresca o devuelve a /login')
# DAS-010 / EMP-006 api: perfil propio no expone otras comisiones
c,pf=req('GET','/rest/v1/perfiles?select=id,comision_pct',vt)
c2,ve=req('POST','/rest/v1/rpc/ventas_por_empleado',vt,{'p_desde':'2026-01-01','p_hasta':'2026-12-31'})
S['ve_v']=ve; save(S)
print(pf, ve)
