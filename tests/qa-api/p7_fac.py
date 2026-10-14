from lib import *
S=tokens(); at,vt,bt=S['at'],S['vt'],S['bt']; pa,pb,cli,f1,fd=S['pa'],S['pb'],S['cli'],S['f1'],S['fd']
def stock(p): return req('GET',f'/rest/v1/productos?select=stock&id=eq.{p}',at)[1][0]['stock']
ia=S['f1items'][str(pa)]; ib=S['f1items'][str(pb)]
sa=stock(pa)
c,dv=req('POST','/rest/v1/rpc/registrar_devolucion',at,{'p_factura_id':f1,'p_items':[{'factura_item_id':ia,'cantidad':1}],'p_motivo':'QA devolución parcial','p_reintegra_stock':True})
sa2=stock(pa); D=req('GET',f'/rest/v1/devoluciones?select=total_devuelto&id=eq.{dv}',at)[1]
N=req('GET',f'/rest/v1/facturas_netas?select=total_neto&id=eq.{f1}',at)[1][0]
rec('FAC-011', c==200 and sa2==sa+1 and int(D[0]['total_devuelto'])==5000 and int(N['total_neto'])==8000, f'Devolución parcial de 1 funda: stock {sa}→{sa2}, devuelto {D[0]["total_devuelto"]}, neto de la factura 13.000→{N["total_neto"]}', 'rpc registrar_devolucion')
c1,e1=req('POST','/rest/v1/rpc/registrar_devolucion',at,{'p_factura_id':f1,'p_items':[{'factura_item_id':ia,'cantidad':2}],'p_motivo':'QA repetir','p_reintegra_stock':True})
c2,e2=req('POST','/rest/v1/rpc/anular_factura',at,{'p_factura_id':f1,'p_motivo':'QA'})
# completar devolución para dejar neto 0
req('POST','/rest/v1/rpc/registrar_devolucion',at,{'p_factura_id':f1,'p_items':[{'factura_item_id':ia,'cantidad':1},{'factura_item_id':ib,'cantidad':1}],'p_motivo':'QA devolución total','p_reintegra_stock':True})
c3,e3=req('POST','/rest/v1/rpc/registrar_devolucion',at,{'p_factura_id':f1,'p_items':[{'factura_item_id':ib,'cantidad':1}],'p_motivo':'QA repetir','p_reintegra_stock':True})
N2=req('GET',f'/rest/v1/facturas_netas?select=total_neto&id=eq.{f1}',at)[1][0]
# anulación de factura con descuento y repetirla
sb=stock(pb)
c4,e4=req('POST','/rest/v1/rpc/anular_factura',at,{'p_factura_id':fd,'p_motivo':'QA anulación autorizada'})
sb2=stock(pb)
c5,e5=req('POST','/rest/v1/rpc/anular_factura',at,{'p_factura_id':fd,'p_motivo':'QA repetir'})
sb3=stock(pb)
F=req('GET',f'/rest/v1/facturas?select=estado,anulada_por,motivo_anulacion,anulada_en&id=eq.{fd}',at)[1][0]
ac=req('GET',f'/rest/v1/actividad?select=accion,perfil_id&entidad_id=eq.{fd}&accion=eq.factura.anulada',at)[1]
rec('FAC-009', c4 in (200,204) and sb2==sb+1 and F['estado']=='anulada' and len(ac)==1, f'Estado anulada por admin, motivo «{F["motivo_anulacion"]}»; stock {sb}→{sb2}; 1 registro en actividad', 'rpc anular_factura')
rec('FAC-015', c1>=400 and c2>=400 and c3>=400 and c5>=400 and sb3==sb2 and int(N2['total_neto'])==0, f'Devolver más de lo vendido: «{e1}»; anular con devoluciones: «{e2}»; devolver otra vez: «{e3}»; anular dos veces: «{e5}»; stock sin duplicar ({sb3})', '')
c6,e6=req('POST','/rest/v1/rpc/anular_factura',vt,{'p_factura_id':f1,'p_motivo':'QA'})
st=req('GET',f'/rest/v1/facturas?select=estado&id=eq.{f1}',at)[1][0]['estado']
rec('FAC-010', c6>=400 and st=='emitida', f'Vendedor por API → «{e6}»; factura sigue {st}. En la UI pide correo y contraseña del administrador.', 'tiene_permiso(anular_facturas)')
# FAC-012
c,u=req('PATCH',f'/rest/v1/facturas?id=eq.{f1}',at,{'total':1},'return=representation')
c2,u2=req('PATCH',f'/rest/v1/factura_items?factura_id=eq.{f1}',at,{'cantidad':9},'return=representation')
c3,u3=req('DELETE',f'/rest/v1/facturas?id=eq.{f1}',at,None,'return=representation')
T=req('GET',f'/rest/v1/facturas?select=total&id=eq.{f1}',at)[1][0]
rec('FAC-012', int(T['total'])==13000, f'PATCH total (admin) → {c} filas {len(u) if isinstance(u,list) else u}; PATCH ítems → {c2} filas {len(u2) if isinstance(u2,list) else u2}; DELETE → {c3} filas {len(u3) if isinstance(u3,list) else u3}; total intacto {T["total"]}', 'Sin políticas de update/delete en facturas')
c,x=req('GET','/rest/v1/facturas?select=id&id=eq.99999999',at); c2,x2=req('POST','/rest/v1/rpc/anular_factura',at,{'p_factura_id':99999999,'p_motivo':'QA'})
rec('FAC-013', x==[] and c2>=400, f'Consulta id inexistente → {x}; acción → «{x2}»', '')
# idempotencia
items=[{'producto_id':pb,'cantidad':1,'descuento':0}]
body={'p_cliente_id':cli,'p_metodo_pago':'efectivo','p_items':items,'p_descuento':0,'p_notas':'QA reintento'}
c,r1=req('POST','/rest/v1/rpc/emitir_factura',vt,body); c2,r2=req('POST','/rest/v1/rpc/emitir_factura',vt,body)
S['dup']=[r1,r2]; save(S)
print('dup', c, r1, c2, r2)
for f in (r1,r2):
    if isinstance(f,int): req('POST','/rest/v1/rpc/anular_factura',at,{'p_factura_id':f,'p_motivo':'QA reintento duplicado'})
