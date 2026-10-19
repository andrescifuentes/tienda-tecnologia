-- PREPARADO LOCALMENTE: revisar/autorizar antes de aplicar. No ejecutado remotamente.
-- Aplicar DESPUÉS de 10_multi_negocio.sql y 15_datos_empresa.sql de Andrés.
-- Usa mi_negocio(); no cambia RLS existente, importes ni facturas históricas.
begin;
alter table public.tienda add column if not exists local text;
alter table public.tienda add column if not exists datos_extra jsonb not null default '[]'::jsonb;
alter table public.tienda add column if not exists razon_social text;
alter table public.tienda add column if not exists nit_dv text;
alter table public.tienda add column if not exists ciudad text;
alter table public.tienda add column if not exists whatsapp text;
alter table public.tienda add column if not exists logo_data_url text;
alter table public.tienda add column if not exists nombre_personalizado boolean not null default false;
alter table public.facturas add column if not exists tienda_snapshot jsonb;
create or replace function public.empresa_datos_validos(p jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,public as $$
declare k text; v text; lim integer; n integer;
begin
 if p is null or jsonb_typeof(p)<>'object' then return false; end if;
 select count(*) into n from jsonb_object_keys(p);
 if n<>13 or (p-array['nombre','razon_social','nit','nit_dv','direccion','ciudad','telefono','whatsapp','correo','logo_data_url','factura_pie','local','datos_extra'])<>'{}'::jsonb then return false; end if;
 for k,v in select key,value#>>'{}' from jsonb_each(p) where key<>'datos_extra' loop
  if jsonb_typeof(p->k)<>'string' then return false; end if;
  lim:=case k when 'nombre' then 100 when 'razon_social' then 160 when 'nit' then 15 when 'nit_dv' then 1 when 'direccion' then 200 when 'ciudad' then 100 when 'telefono' then 40 when 'whatsapp' then 40 when 'correo' then 254 when 'factura_pie' then 1000 when 'logo_data_url' then 350000 when 'local' then 100 else 0 end;
  if length(v)>lim or v<>trim(v) then return false; end if;
  if k<>'factura_pie' and v~E'[\r\n\t]' then return false; end if;
 end loop;
 if jsonb_typeof(p->'datos_extra')<>'array' or jsonb_array_length(p->'datos_extra')>20 then return false;end if;
 for k,v in select item->>'etiqueta',item->>'valor' from jsonb_array_elements(p->'datos_extra')item loop
  if k is null or v is null or length(k)>80 or length(v)>300 or k<>trim(k) or v<>trim(v) or k~E'[\r\n\t]' or v~E'[\r\n\t]' then return false;end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p->'datos_extra')item where jsonb_typeof(item)<>'object' or jsonb_typeof(item->'etiqueta')<>'string' or jsonb_typeof(item->'valor')<>'string' or(item-array['etiqueta','valor'])<>'{}'::jsonb)then return false;end if;
 if length(p->>'nombre')=0 then return false; end if;
 if p->>'nit'<>'' and p->>'nit'!~'^[0-9]{5,15}$' then return false; end if;
 if p->>'nit_dv'<>'' and (p->>'nit_dv'!~'^[0-9]$' or p->>'nit'='') then return false; end if;
 foreach k in array array['telefono','whatsapp'] loop
  v:=p->>k;
  if v<>'' and (v!~'^[+0-9() .-]+$' or regexp_replace(v,'[^0-9]','','g')!~'^[0-9]{7,20}$') then return false; end if;
 end loop;
 if p->>'correo'<>'' and p->>'correo'!~'^[^[:space:]@<>;,]+@[^[:space:]@<>;,]+\.[^[:space:]@<>;,]+$' then return false; end if;
 v:=p->>'logo_data_url';
 if v<>'' then
  if v!~'^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$' then return false; end if;
  if not (v like 'data:image/png;base64,iVBORw0KGgo%' or v like 'data:image/jpeg;base64,/9j/%') then return false; end if;
  begin if octet_length(decode(split_part(v,',',2),'base64'))>262144 then return false; end if; exception when others then return false; end;
 end if;
 return true;
end $$;
revoke all on function public.empresa_datos_validos(jsonb) from public,anon;
grant execute on function public.empresa_datos_validos(jsonb) to authenticated,service_role;
create or replace function public.guardar_datos_empresa(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare saved jsonb;
begin
 if public.es_admin() is not true or public.es_activo() is not true or public.mi_negocio() is null then raise exception 'FORBIDDEN'; end if;
 if public.empresa_datos_validos(p_datos) is not true then raise exception 'INVALID_BUSINESS_DATA'; end if;
 update public.tienda set nombre=p_datos->>'nombre',razon_social=nullif(p_datos->>'razon_social',''),nit=nullif(p_datos->>'nit',''),nit_dv=nullif(p_datos->>'nit_dv',''),direccion=nullif(p_datos->>'direccion',''),ciudad=nullif(p_datos->>'ciudad',''),telefono=nullif(p_datos->>'telefono',''),whatsapp=nullif(p_datos->>'whatsapp',''),correo=nullif(p_datos->>'correo',''),logo_data_url=nullif(p_datos->>'logo_data_url',''),factura_pie=nullif(p_datos->>'factura_pie',''),local=nullif(p_datos->>'local',''),datos_extra=p_datos->'datos_extra',nombre_personalizado=true where id=public.mi_negocio() returning to_jsonb(tienda)-'ultimo_numero_factura' into saved;
 if not found then raise exception 'STORE_NOT_FOUND'; end if;
 return saved;
end $$;
revoke all on function public.guardar_datos_empresa(jsonb) from public,anon;
grant execute on function public.guardar_datos_empresa(jsonb) to authenticated;
-- Freeze store identity only on a future INSERT. Existing snapshots/rows stay untouched.
create or replace function public.empresa_congelar_factura() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.mi_negocio() is not null and new.negocio_id is distinct from public.mi_negocio()then raise exception 'FORBIDDEN';end if;
 if new.tienda_snapshot is null then
  select jsonb_build_object('id',t.id,'nombre',t.nombre,'nombre_personalizado',t.nombre_personalizado,'razon_social',t.razon_social,'nit',t.nit,'nit_dv',t.nit_dv,'direccion',t.direccion,'ciudad',t.ciudad,'telefono',t.telefono,'whatsapp',t.whatsapp,'correo',t.correo,'logo_url',t.logo_url,'logo_data_url',t.logo_data_url,'factura_pie',t.factura_pie,'local',t.local,'datos_extra',t.datos_extra)into new.tienda_snapshot from public.tienda t where t.id=new.negocio_id;
  if not found then raise exception 'STORE_NOT_FOUND';end if;
 end if;
 return new;
end $$;
revoke all on function public.empresa_congelar_factura() from public,anon,authenticated;
drop trigger if exists empresa_identidad_futura on public.facturas;
create trigger empresa_identidad_futura before insert on public.facturas for each row execute function public.empresa_congelar_factura();
-- Safe optional read for clients using older seller views without snapshot columns.
create or replace function public.empresa_factura_snapshot(p_factura_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare identity jsonb;
begin
 if public.es_activo() is not true then raise exception 'FORBIDDEN'; end if;
 select f.tienda_snapshot into identity from public.facturas f where f.id=p_factura_id and f.negocio_id=public.mi_negocio() and (public.es_admin() or f.vendedor_id=auth.uid());
 if not found then raise exception 'FORBIDDEN'; end if;
 return identity;
end $$;
revoke all on function public.empresa_factura_snapshot(bigint) from public,anon;
grant execute on function public.empresa_factura_snapshot(bigint) to authenticated;

-- Keep the public link and expiry checks from Andres; expose only business identity.
do $public_upgrade$ begin
 if to_regprocedure('public.factura_publica(text)') is not null then
 execute $public_payload$create or replace function factura_publica(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e factura_enlaces%rowtype; f facturas%rowtype;
begin
  if p_token is null or length(p_token) <> 12 then return null; end if;
  select * into e from factura_enlaces where token = p_token and vence_en > now();
  if not found then return null; end if;
  select * into f from facturas where id = e.factura_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'factura', jsonb_build_object('id', f.id, 'prefijo', f.prefijo, 'numero', f.numero, 'fecha', f.fecha, 'estado', f.estado,
                                  'subtotal', f.subtotal, 'descuento', f.descuento, 'total', f.total,
                                  'metodo_pago', f.metodo_pago, 'notas', f.notas,
                                  'devuelto', (select coalesce(sum(total_devuelto), 0) from devoluciones where factura_id = f.id)),
    'cliente', (select jsonb_build_object('nombre', c.nombre, 'tipo_documento', c.tipo_documento, 'documento', c.documento,
                                          'telefono', c.telefono, 'correo', c.correo, 'direccion', c.direccion)
                  from clientes c where c.id = f.cliente_id),
    'vendedor', (select jsonb_build_object('nombre', p.nombre) from perfiles p where p.id = f.vendedor_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', i.cantidad,
                                                           'precio_unitario', i.precio_unitario, 'descuento', i.descuento) order by i.id), '[]'::jsonb)
                from factura_items i where i.factura_id = f.id),
    'tienda', coalesce((select jsonb_object_agg(k,v) from jsonb_each(case when jsonb_typeof(f.tienda_snapshot)='object' then f.tienda_snapshot else '{}'::jsonb end) x(k,v) where k=any(array['id','nombre','nit','nit_dv','razon_social','direccion','ciudad','telefono','whatsapp','correo','local','datos_extra','factura_pie','logo_url','logo_data_url'])), (select jsonb_build_object('id', t.id, 'nombre', t.nombre, 'nit', t.nit, 'direccion', t.direccion, 'telefono', t.telefono,
                                         'correo', t.correo, 'local', t.local, 'datos_extra', t.datos_extra, 'factura_pie', t.factura_pie, 'logo_url', t.logo_url)
                 from tienda t where t.id = f.negocio_id))
  );
end $$;$public_payload$;
 end if;
end $public_upgrade$;
commit;
