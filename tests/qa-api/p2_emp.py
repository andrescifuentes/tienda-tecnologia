from lib import *
S=tokens(); at=S['at']
body={'nombre':'QA Vendedor B','correo':'qa.vendedor2@prueba.com','password':'QaVendedor2026','rol':'vendedor','permisos':['vender','ver_inventario','crear_clientes']}
c,d=req('POST','/functions/v1/crear-empleado',at,body)
print(c,d)
c2,pf=req('GET','/rest/v1/perfiles?select=id,nombre,rol,activo&correo=eq.qa.vendedor2@prueba.com',at)
c3,pp=req('GET',f'/rest/v1/perfil_permisos?select=permiso&perfil_id=eq.{pf[0]["id"]}',at) if pf else (0,[])
ok = bool(pf) and sorted(x['permiso'] for x in pp)==sorted(body['permisos'])
rec('EMP-001', ok, f'Función crear-empleado → {c}; perfil {pf[0]["nombre"] if pf else "-"} rol {pf[0]["rol"] if pf else "-"}; permisos {[x["permiso"] for x in pp]}', 'Edge Function crear-empleado + perfiles/perfil_permisos')
if pf: S['bid']=pf[0]['id']; save(S)
c,l=login('qa.vendedor2@prueba.com','QaVendedor2026'); print('login B',c)
if c==200: S['bt']=l['access_token']; save(S)
