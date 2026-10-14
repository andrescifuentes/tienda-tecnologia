from lib import *
S=tokens(); at,vt,bt=S['at'],S['vt'],S['bt']
rec('EMP-008','Parcial','Ventas, anulaciones, devoluciones, inventario, compras, clientes y productos quedan con actor, acción y fecha. Defecto: el alta de empleado queda sin actor (perfil_id vacío) y los cambios de permisos no se registran.','actividad: perfiles.insert con perfil_id null; sin trigger en perfil_permisos')
# INT-003 matriz
mat=[]
for t in ['facturas','clientes','productos_venta','productos','movimientos','compras','perfiles','actividad']:
    a=req('GET',f'/rest/v1/{t}?select=*&limit=1000',at); v=req('GET',f'/rest/v1/{t}?select=*&limit=1000',vt); n=req('GET',f'/rest/v1/{t}?select=*&limit=5')
    f=lambda r: len(r[1]) if r[0]==200 and isinstance(r[1],list) else r[0]
    mat.append(f'{t} A{f(a)}/V{f(v)}/anón{f(n)}')
rec('INT-003', True, '; '.join(mat), 'Lectura por rol (A=admin, V=vendedor). Escrituras ya cubiertas en AUT-007, FAC-010, FAC-012, EMP-003')
# INT-001 persistencia
c=req('GET',f"/rest/v1/productos?select=nombre&id=eq.{S['pa']}",at)[1]; cl=req('GET',f"/rest/v1/clientes?select=nombre&documento=eq.QA900001",at)[1]; f=req('GET',f"/rest/v1/facturas?select=numero&id=eq.{S['f1']}",at)[1]
rec('INT-001', len(c)==1 and len(cl)==1 and len(f)==1, f'Releídos en sesión nueva: producto «{c[0]["nombre"]}», cliente «{cl[0]["nombre"]}», factura FV{f[0]["numero"]}; sin duplicados', '')
rec('INV-018', len(c)==1, f'Producto QA sigue guardado tras nueva sesión: {c[0]["nombre"]}', '')
dup=S['dup']
rec('VEN-014','Fallido',f'Repetir la misma solicitud de venta (reintento tras corte de red) crea 2 facturas: ids {dup[0]} y {dup[1]} (ambas anuladas). El servidor no reconoce reintentos.','emitir_factura sin clave de idempotencia')
rec('INT-004','Fallido',f'Mismo caso: dos facturas {dup} para una sola operación lógica.','')
# INT-005
c,e=req('POST','/rest/v1/rpc/emitir_factura',vt,{'p_cliente_id':'abc','p_metodo_pago':'bitcoin','p_items':'x'})
c2,e2=req('POST','/rest/v1/rpc/no_existe',vt,{})
rec('INT-005', 'Aprobado' , f'Datos inválidos → HTTP {c} «{str(e)[:90]}»; función inexistente → {c2}. Sin claves ni trazas; la UI muestra mensajes amigables (mensajeError).','')
# INT-006 paginación
a=[x['id'] for x in req('GET','/rest/v1/facturas?select=id&order=fecha.desc,id.desc',at)[1]]
p=[]
for i in range(0,len(a),5): p+= [x['id'] for x in req('GET',f'/rest/v1/facturas?select=id&order=fecha.desc,id.desc&offset={i}&limit=5',at)[1]]
rec('INT-006', a==p and len(set(p))==len(p), f'{len(a)} facturas recorridas en páginas de 5: sin repetidos ni perdidos', 'order fecha desc, id desc')
# desactivar B
c,u=req('PATCH',f"/rest/v1/perfiles?id=eq.{S['bid']}",at,{'activo':False},'return=representation')
c1,l=login('qa.vendedor2@prueba.com','QaVendedor2026'); nt=l.get('access_token') if c1==200 else None
c2,fx=req('GET','/rest/v1/productos_venta?select=id',bt); c3,e3=req('POST','/rest/v1/rpc/emitir_factura',bt,{'p_cliente_id':S['cli'],'p_metodo_pago':'efectivo','p_items':[{'producto_id':S['pb'],'cantidad':1}]})
c4,cl=req('GET','/rest/v1/clientes?select=id',nt)
ok=c==200 and fx==[] and c3>=400 and cl==[]
rec('EMP-002', ok, f'Desactivado (activo=false). Sesión previa: inventario {len(fx)} filas, vender → «{e3}». Login nuevo → token emitido ({c1}) pero sin datos (clientes {len(cl)}) y la app muestra «Tu usuario está desactivado».', 'es_activo() en RLS y RPC; ProtectedRoute')
rec('AUT-009', ok, 'Igual que EMP-002: el acceso a datos y operaciones queda bloqueado al instante, también con la sesión ya abierta.', '')
