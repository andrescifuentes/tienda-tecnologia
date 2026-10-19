-- PREPARADO LOCALMENTE: revisar/autorizar antes de aplicar. No ejecutado remotamente.
-- Tienda única id=1 del esquema actual. No modifica RLS, importes ni facturas existentes.
begin;
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
 if n<>11 or (p-array['nombre','razon_social','nit','nit_dv','direccion','ciudad','telefono','whatsapp','correo','logo_data_url','factura_pie'])<>'{}'::jsonb then return false; end if;
 for k,v in select key,value#>>'{}' from jsonb_each(p) loop
  if jsonb_typeof(p->k)<>'string' then return false; end if;
  lim:=case k when 'nombre' then 100 when 'razon_social' then 160 when 'nit' then 15 when 'nit_dv' then 1 when 'direccion' then 200 when 'ciudad' then 100 when 'telefono' then 40 when 'whatsapp' then 40 when 'correo' then 254 when 'factura_pie' then 1000 when 'logo_data_url' then 350000 else 0 end;
  if length(v)>lim or v<>trim(v) then return false; end if;
  if k<>'factura_pie' and v~E'[\r\n\t]' then return false; end if;
 end loop;
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
 if public.es_admin() is not true or public.es_activo() is not true then raise exception 'FORBIDDEN'; end if;
 if public.empresa_datos_validos(p_datos) is not true then raise exception 'INVALID_BUSINESS_DATA'; end if;
 update public.tienda set nombre=p_datos->>'nombre',razon_social=nullif(p_datos->>'razon_social',''),nit=nullif(p_datos->>'nit',''),nit_dv=nullif(p_datos->>'nit_dv',''),direccion=nullif(p_datos->>'direccion',''),ciudad=nullif(p_datos->>'ciudad',''),telefono=nullif(p_datos->>'telefono',''),whatsapp=nullif(p_datos->>'whatsapp',''),correo=nullif(p_datos->>'correo',''),logo_data_url=nullif(p_datos->>'logo_data_url',''),factura_pie=nullif(p_datos->>'factura_pie',''),nombre_personalizado=true where id=1 returning to_jsonb(tienda)-'ultimo_numero_factura' into saved;
 if not found then raise exception 'STORE_NOT_FOUND'; end if;
 return saved;
end $$;
revoke all on function public.guardar_datos_empresa(jsonb) from public,anon;
grant execute on function public.guardar_datos_empresa(jsonb) to authenticated;
-- Freeze store identity only on a future INSERT. Existing snapshots/rows stay untouched.
create or replace function public.empresa_congelar_factura() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.tienda_snapshot is null then select to_jsonb(t)-'ultimo_numero_factura'-'plantillas_factura' into new.tienda_snapshot from public.tienda t where t.id=1; end if;
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
 select f.tienda_snapshot into identity from public.facturas f where f.id=p_factura_id and (public.es_admin() or f.vendedor_id=auth.uid());
 if not found then raise exception 'FORBIDDEN'; end if;
 return identity;
end $$;
revoke all on function public.empresa_factura_snapshot(bigint) from public,anon;
grant execute on function public.empresa_factura_snapshot(bigint) to authenticated;
commit;
