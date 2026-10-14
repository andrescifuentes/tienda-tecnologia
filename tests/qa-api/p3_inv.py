from lib import *
S=tokens(); at,vt=S['at'],S['vt']
# proveedor
c,pv=req('POST','/rest/v1/proveedores',at,{'nombre':'QA Proveedor Pruebas','telefono':'3000000001','correo':'qa.proveedor@prueba.com'},'return=representation')
rec('PRO-001', c==201, f'HTTP {c}; proveedor id {pv[0]["id"] if c==201 else pv}', 'Formulario simplificado: Nombre*, WhatsApp, Correo')
S['prov']=pv[0]['id']
c,e=req('POST','/rest/v1/proveedores',at,{'telefono':'1'},'return=representation')
rec('PRO-006', c>=400, f'Sin nombre → HTTP {c} «{e}»; la UI exige Nombre*', 'NOT NULL en proveedores.nombre')
# productos
base={'categoria_id':6,'marca':'QA','modelo':'iPhone 15','color':'Negro','precio_compra':1000,'precio_venta':5000,'stock_min':3,'proveedor_id':S['prov'],'garantia_meses':6,'descripcion':'Producto de prueba QA'}
c,a=req('POST','/rest/v1/productos',at,dict(base,codigo='QA-FUNDA-IP15-NEG',nombre='QA Funda iPhone 15'),'return=representation')
c2,b=req('POST','/rest/v1/productos',at,dict(base,codigo='QA-CABLE-USBC',nombre='QA Cable USB-C',categoria_id=8,modelo=None,garantia_meses=0,precio_venta=3000),'return=representation')
ok=c==201 and c2==201
rec('INV-001', ok, f'Productos creados: {a[0]["codigo"] if ok else a} y {b[0]["codigo"] if ok else b}', 'POST productos (admin)')
rec('INV-002', ok and a[0].get('foto_url') is None, 'Guardado sin foto_url (null); la tarjeta usa el placeholder común', 'foto_url null')
S['pa'],S['pb']=a[0]['id'],b[0]['id']; save(S)
c,d=req('POST','/rest/v1/productos',at,dict(base,codigo='QA-FUNDA-IP15-NEG',nombre='QA duplicado'),'return=representation')
rec('INV-004', c==409, f'Segundo producto con el mismo SKU → HTTP {c} «{d}». La UI además busca un código libre (sufijo).', 'unique(productos.codigo) + codigoLibre() en ProductoForm')
c,d=req('POST','/rest/v1/productos',at,{'codigo':'QA-X','precio_venta':1000},'return=representation')
rec('INV-003', c>=400, f'Sin nombre → HTTP {c} «{d}»', 'NOT NULL nombre + validación del formulario')
c,d=req('POST','/rest/v1/productos',at,dict(base,codigo='QA-NEG',nombre='QA negativo',precio_venta=-100),'return=representation')
rec('INV-017', c>=400, f'Precio -100 → HTTP {c} «{d}»', 'check (precio_venta >= 0); MoneyInput solo admite dígitos')
c,d=req('PATCH',f'/rest/v1/productos?id=eq.{S["pa"]}',vt,{'codigo':'QA-HACK'},'return=representation')
c2,d2=req('PATCH',f'/rest/v1/productos?id=eq.{S["pb"]}',at,{'codigo':'QA-FUNDA-IP15-NEG'},'return=representation')
rec('INV-016', (c>=400 or d==[]) and c2==409, f'Vendedor cambia SKU → {c} filas {d if c>=400 else len(d)}; admin pone SKU repetido → {c2} «{d2}»', 'RLS productos_update + unique')
c,d=req('PATCH',f'/rest/v1/productos?id=eq.{S["pa"]}',at,{'nombre':'QA Funda iPhone 15 Pro','marca':'QA Marca','modelo':'iPhone 15 Pro'},'return=representation')
c2,g=req('GET',f'/rest/v1/productos?select=nombre,marca,modelo&id=eq.{S["pa"]}',at)
rec('INV-005', g[0]['nombre']=='QA Funda iPhone 15 Pro' and g[0]['modelo']=='iPhone 15 Pro', f'Tras editar y releer: {g[0]}', 'PATCH + GET')
c,g=req('GET',f'/rest/v1/productos?select=precio_compra,precio_venta&id=eq.{S["pa"]}',at)
c2,gv=req('GET',f'/rest/v1/productos_venta?select=*&id=eq.{S["pa"]}',vt)
rec('INV-006', g[0]=={'precio_compra':1000,'precio_venta':5000} and 'precio_compra' not in gv[0], f'Admin ve compra {g[0]["precio_compra"]} / venta {g[0]["precio_venta"]}; vendedor ve solo precio_venta {gv[0]["precio_venta"]}', 'vista productos_venta sin costos')
c,f=req('GET',"/rest/v1/productos_venta?select=nombre,categoria,marca,modelo&modelo=ilike.*iPhone%2015*",vt)
rec('INV-007', any(x['nombre'].startswith('QA Funda') and x['categoria']=='Fundas' for x in f), f'Búsqueda por modelo «iPhone 15»: {[ (x["nombre"],x["categoria"],x["modelo"]) for x in f][:4]}', 'Categoría Fundas + modelo compatible')
q=[('nombre','QA%20Cable'),('codigo','QA-CABLE'),('marca','QA')]
out=[]
for col,v in q:
    c,f=req('GET',f'/rest/v1/productos_venta?select=codigo&{col}=ilike.*{v}*',vt); out.append(f'{col}:{len(f)}')
rec('INV-008', all(not o.endswith(':0') for o in out), 'Coincidencias por '+', '.join(out), 'Buscador de Inventario filtra nombre, SKU y marca')
c,fl=req('GET','/rest/v1/productos_venta?select=categoria,stock,stock_min&categoria=eq.Fundas',vt)
rec('INV-009', all(x['categoria']=='Fundas' for x in fl), f'Filtro Fundas → {len(fl)} productos, todos Fundas', 'Hoja de filtros (categoría, marca, agotado/bajo)')
save(S)
