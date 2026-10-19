import json, urllib.request, urllib.error, time, os
U='https://baowsvrfihsimnptxuxi.supabase.co'; K='sb_publishable_lG2rON3S2VSpfieXbKeMMw__U5j0yuJ'
def req(method, path, token=None, body=None, prefer=None, extra=None):
    h={'apikey':K,'Content-Type':'application/json'}
    if token: h['Authorization']='Bearer '+token
    if prefer: h['Prefer']=prefer
    if extra: h.update(extra)
    r=urllib.request.Request(U+path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r, timeout=40) as x:
            t=x.read().decode()
            try: return x.status, (json.loads(t) if t else None)
            except Exception: return x.status, t
    except urllib.error.HTTPError as e:
        t=e.read().decode()
        try: j=json.loads(t); return e.code, j.get('message') or j.get('msg') or j.get('error_description') or j.get('error') or j
        except Exception: return e.code, t[:300]
def login(e,p): return req('POST','/auth/v1/token?grant_type=password',body={'email':e,'password':p})
ST='state.json'
def load():
    return json.load(open(ST)) if os.path.exists(ST) else {}
def save(s): json.dump(s,open(ST,'w'),indent=1,ensure_ascii=False)
RES='res.json'
def rec(cid, ok, obtenido, evid=''):
    r=json.load(open(RES)) if os.path.exists(RES) else {}
    r[cid]={'estado': ok if isinstance(ok,str) else ('Aprobado' if ok else 'Fallido'),'obtenido':str(obtenido)[:300],'evid':str(evid)[:300]}
    json.dump(r,open(RES,'w'),indent=1,ensure_ascii=False)
    print(cid, r[cid]['estado'], '|', r[cid]['obtenido'][:160])
def tokens():
    s=load()
    if s.get('tok_t',0)>time.time()-2400: return s
    a=login('admin@prueba.com','Admin12345')[1]; v=login('vendedor@prueba.com','Vendedor12345')[1]
    s.update(at=a['access_token'],vt=v['access_token'],aid=a['user']['id'],vid=v['user']['id'],tok_t=time.time()); save(s); return s
