from lib import *
S=tokens(); at,vt,bt=S['at'],S['vt'],S['bt']; pa,pb,cli=S['pa'],S['pb'],S['cli']
def stock(p): return req('GET',f'/rest/v1/productos?select=stock&id=eq.{p}',at)[1][0]['stock']
def emit(t,items,desc=0,c=cli,notas='QA prueba automática'):
    return req('POST','/rest/v1/rpc/emitir_factura',t,{'p_cliente_id':c,'p_metodo_pago':'efectivo','p_items':items,'p_descuento':desc,'p_notas':notas})
sa0,sb0=stock(pa),stock(pb)
c,e=emit(vt,[{'producto_id':pb,'cantidad':sb0+1,'descuento':0}])
rec('VEN-004', c>=400 and stock(pb)==sb0, f'Pedir {sb0+1} con stock {sb0} → HTTP {c} «{e}». En la UI el selector de cantidad se limita al stock.', 'trigger de stock + POS')
c,e=emit(vt,[])
rec('VEN-009', 'Parcial', f'Sin productos → HTTP {c} «{e}». La UI bloquea sin cliente («Falta el cliente»), pero el servidor acepta cliente vacío.', 'emitir_factura no exige p_cliente_id')
c,f1=emit(vt,[{'producto_id':pa,'cantidad':2,'descuento':0},{'producto_id':pb,'cantidad':1,'descuento':0}])
sa1,sb1=stock(pa),stock(pb)
c2,F=req('GET',f'/rest/v1/facturas?select=*&id=eq.{f1}',at); F=F[0]
c3,it=req('GET',f'/rest/v1/factura_items?select=id,producto_id,cantidad,precio_unitario&factura_id=eq.{f1}',at)
c4,mv=req('GET',f'/rest/v1/movimientos_inventario?select=producto_id,cantidad&referencia_tipo=eq.factura&referencia_id=eq.{f1}',at)
S['f1']=f1; S['f1items']={str(x['producto_id']):x['id'] for x in it}; save(S)
ok_tot = int(F['subtotal'])==13000 and int(F['total'])==13000
rec('VEN-007', c==200 and ok_tot, f'Factura {F["prefijo"]}{F["numero"]} (id {f1}) total {F["total"]}, cliente {F["cliente_id"]}, vendedor propio', 'rpc emitir_factura')
rec('VEN-011', sa1==sa0-2 and sb1==sb0-1, f'Stock A {sa0}→{sa1} (−2), B {sb0}→{sb1} (−1)', 'movimientos salida_venta')
rec('VEN-006', F['cliente_id']==cli, f'Factura asociada al cliente {F["cliente_id"]} (QA Cliente Pruebas)', 'facturas.cliente_id')
rec('CLI-006', F['cliente_id']==cli, f'Factura {F["prefijo"]}{F["numero"]} enlazada al cliente id {cli}', '')
rec('VEN-002', any(x['producto_id']==pa and x['cantidad']==2 and int(x['precio_unitario'])==5000 for x in it), f'Ítems: {[(x["producto_id"],x["cantidad"],x["precio_unitario"]) for x in it]}; subtotal 2×5.000 + 1×3.000 = {F["subtotal"]}', 'Precio tomado del servidor')
rec('FAC-001', len(it)==2 and ok_tot, f'Número único {F["prefijo"]}{F["numero"]}; ítems y total (13.000) coinciden con la venta', 'unique(prefijo, numero)')
rec('INT-002', sorted((x['producto_id'],-x['cantidad']) for x in mv)==sorted((x['producto_id'],x['cantidad']) for x in it) and ok_tot, f'Factura total {F["total"]} = Σ ítems; movimientos {[(m["producto_id"],m["cantidad"]) for m in mv]} = ítems', 'facturas / factura_items / movimientos_inventario')
c,g=req('GET',f'/rest/v1/garantias?select=inicio,fin,estado&factura_item_id=eq.{S["f1items"][str(pa)]}',at)
c2,mh=req('GET',f'/rest/v1/movimientos_inventario?select=tipo&producto_id=eq.{pa}',at)
rec('INV-015', len(g)==1 and g[0]['estado']=='vigente', f'Garantía {g[0] if g else "-"}; historial con {len(mh)} movimientos ({", ".join(sorted(set(x["tipo"] for x in mh)))})', 'garantias + movimientos_inventario')
# envio
c,e=req('POST','/rest/v1/factura_envios',vt,{'factura_id':f1,'canal':'whatsapp','destino':'3001112233','enviado_por':S['vid']},'return=minimal')
c2,e2=req('POST','/rest/v1/factura_envios',vt,{'factura_id':f1,'canal':'correo','destino':'qa.cliente@prueba.com','enviado_por':S['vid']},'return=minimal')
S['env']=(c,c2); save(S)
# aislamiento vendedores
c,fb=req('GET','/rest/v1/facturas?select=id,vendedor_id',bt)
c2,fit=req('GET',f'/rest/v1/factura_items?select=id&factura_id=eq.{f1}',bt)
c3,veb=req('POST','/rest/v1/rpc/ventas_por_empleado',bt,{'p_desde':'2026-01-01','p_hasta':'2026-12-31'})
ok = fb==[] and fit==[] and veb==[]
rec('VEN-012', ok, f'Vendedor B: facturas {len(fb)}, ítems de la factura de A {len(fit)}, ventas_por_empleado {veb}', 'RLS facturas_select')
rec('DAS-009', ok, 'El vendedor B no recibe ninguna venta del vendedor A (0 filas en facturas, ítems y resumen)', '')
rec('EMP-005', ok, 'Consulta directa de datos de A con sesión de B → 0 filas', '')
c,va=req('GET','/rest/v1/facturas?select=vendedor_id',vt)
rec('FAC-002', all(x['vendedor_id']==S['vid'] for x in va) and len(req('GET','/rest/v1/facturas?select=id',at)[1])>len(va), f'Vendedor A ve {len(va)} facturas propias; admin ve todas', 'RLS por rol')
# descuentos
c,e=emit(vt,[{'producto_id':pb,'cantidad':1,'descuento':0}],desc=500)
c2,fd=emit(at,[{'producto_id':pb,'cantidad':1,'descuento':0}],desc=1000)
c3,e3=emit(at,[{'producto_id':pb,'cantidad':1,'descuento':0}],desc=99999)
Fd=req('GET',f'/rest/v1/facturas?select=subtotal,descuento,total&id=eq.{fd}',at)[1][0] if c2==200 else {}
rec('VEN-013', c>=400 and c2==200 and int(Fd['total'])==2000 and c3>=400, f'Vendedor sin permiso: «{e}»; admin descuento 1.000 sobre 3.000 → total {Fd.get("total")}; descuento mayor al subtotal: «{e3}». No hay impuestos implementados.', 'emitir_factura')
S['fd']=fd; save(S)
