from lib import *
S=tokens(); at,vt=S['at'],S['vt']
c,cl=req('POST','/rest/v1/clientes',vt,{'tipo_documento':'CC','documento':'QA900001','nombre':'QA Cliente Pruebas','telefono':'3001112233','correo':'qa.cliente@prueba.com','creado_por':S['vid']},'return=representation')
rec('CLI-001', c==201, f'Vendedor crea cliente → HTTP {c}, id {cl[0]["id"] if c==201 else cl}', 'POST clientes (permiso crear_clientes)')
S['cli']=cl[0]['id']; save(S)
c,e=req('POST','/rest/v1/clientes',vt,{'tipo_documento':'CC','nombre':'QA sin doc'},'return=representation')
rec('CLI-002', c>=400, f'Sin documento → HTTP {c} «{e}»; la UI pide Nombre, documento y WhatsApp (≥10 dígitos)', 'NOT NULL documento + validación ClienteForm')
c,e=req('POST','/rest/v1/clientes',vt,{'tipo_documento':'CC','documento':'QA900001','nombre':'QA Duplicado'},'return=representation')
rec('CLI-007', c==409, f'Mismo tipo y documento → HTTP {c} «{e}» → UI: «Ya existe un registro con esos datos.»', 'unique(tipo_documento, documento)')
c,g=req('GET',f'/rest/v1/clientes?select=telefono,correo&id=eq.{S["cli"]}',vt)
rec('CLI-004', g[0]=={'telefono':'3001112233','correo':'qa.cliente@prueba.com'}, f'Persistido: {g[0]}', 'GET tras guardar')
out=[]
for col,v in [('nombre','QA%20Cliente'),('documento','QA9000')]:
    c,f=req('GET',f'/rest/v1/clientes?select=id&{col}=ilike.*{v}*',vt); out.append(f'{col}:{len(f)}')
rec('CLI-003', all(o.endswith(':1') for o in out), 'Coincidencias: '+', '.join(out), 'Buscador de Clientes y ClientePicker')
save(S)
