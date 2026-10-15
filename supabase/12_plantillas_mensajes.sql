-- PREPARADO LOCALMENTE. No aplicado en Supabase.
-- Configuración en tienda del esquema actual (01). Mantiene RLS y facturas intactas.
-- Revisar la adaptación antes de aplicar sobre una arquitectura multi-negocio distinta.
begin;
create or replace function public.plantillas_factura_validas(p jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,public as $$
declare k text; v text; remaining text; token text; n integer;
begin
 if p is null or jsonb_typeof(p)<>'object' then return false; end if;
 select count(*) into n from jsonb_object_keys(p);
 if n<>3 or (p-array['asunto_correo','mensaje_correo','mensaje_whatsapp'])<>'{}'::jsonb then return false; end if;
 foreach k in array array['asunto_correo','mensaje_correo','mensaje_whatsapp'] loop
  if jsonb_typeof(p->k)<>'string' then return false; end if;
  v:=p->>k;
  if length(trim(v))=0 or length(v)>(case k when 'asunto_correo' then 180 when 'mensaje_correo' then 6000 else 1800 end) then return false; end if;
  if k='asunto_correo' and v~E'[\r\n\t]' then return false; end if;
  for token in select (regexp_matches(v,'\{([^{}]+)\}','g'))[1] loop
   if not token=any(array['cliente','numero_factura','fecha','total','nombre_negocio','productos']) then return false; end if;
  end loop;
  remaining:=regexp_replace(v,'\{[^{}]+\}','','g');
  if remaining~'[{}]' or v~*'sb_secret_|Bearer[[:space:]]+|[?&]token=|/storage/v1/object/(sign|public)/facturas' then return false; end if;
 end loop;
 return true;
end $$;
revoke all on function public.plantillas_factura_validas(jsonb) from public,anon;
grant execute on function public.plantillas_factura_validas(jsonb) to authenticated,service_role;
alter table public.tienda add column if not exists plantillas_factura jsonb;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.tienda'::regclass and conname='tienda_plantillas_factura_validas') then
  alter table public.tienda add constraint tienda_plantillas_factura_validas check(plantillas_factura is null or public.plantillas_factura_validas(plantillas_factura));
 end if;
end $$;
create or replace function public.guardar_plantillas_factura(p_plantillas jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare saved jsonb;
begin
 if public.es_admin() is not true or public.es_activo() is not true then raise exception 'FORBIDDEN'; end if;
 if not public.plantillas_factura_validas(p_plantillas) then raise exception 'INVALID_TEMPLATE'; end if;
 update public.tienda set plantillas_factura=p_plantillas where id=1 returning plantillas_factura into saved;
 if not found then raise exception 'STORE_NOT_FOUND'; end if;
 return saved;
end $$;
revoke all on function public.guardar_plantillas_factura(jsonb) from public,anon;
grant execute on function public.guardar_plantillas_factura(jsonb) to authenticated;

-- Refresh only an already installed mail payload function; identity snapshots are unchanged.
do $upgrade$ begin
 if to_regprocedure('public.correo_factura_documento(uuid,bigint)') is not null then
 execute $message_document$create or replace function public.correo_factura_documento(p_actor uuid,p_factura bigint) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare f facturas%rowtype; pf perfiles%rowtype; c jsonb; v jsonb; t jsonb; its jsonb;
begin
 select * into pf from perfiles where id=p_actor;
 if not found or not pf.activo then raise exception 'FORBIDDEN'; end if;
 select * into f from facturas where id=p_factura;
 if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
 if pf.rol<>'admin' and (f.vendedor_id<>p_actor or not exists(select 1 from perfil_permisos where perfil_id=p_actor and permiso='vender')) then raise exception 'FORBIDDEN'; end if;
 if f.estado<>'emitida' then raise exception 'INVOICE_NOT_ISSUED'; end if;
 select to_jsonb(cl) into c from clientes cl where cl.id=f.cliente_id;
 select jsonb_build_object('nombre',p.nombre) into v from perfiles p where p.id=f.vendedor_id;
 select to_jsonb(s)-'ultimo_numero_factura' into t from tienda s where s.id=1;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'nombre',i.nombre,'cantidad',i.cantidad,'precio_unitario',i.precio_unitario,'descuento',i.descuento,'codigo',coalesce(i.codigo,p.codigo),'serial',coalesce(i.serial,u.serial)) order by i.id),'[]'::jsonb) into its from factura_items i left join productos p on p.id=i.producto_id left join unidades_serializadas u on u.id=i.unidad_id where i.factura_id=f.id;
 -- Older invoices have historical line amounts but no original identity snapshot.
 -- Prefer snapshots; fallback identity is explicitly flagged, never invented.
 return jsonb_build_object('invoice',(to_jsonb(f)-'costo_total'-'comision'-'comision_pct')||jsonb_build_object('cliente_snapshot',coalesce(f.cliente_snapshot,c),'vendedor_snapshot',coalesce(f.vendedor_snapshot,v),'tienda_snapshot',coalesce(f.tienda_snapshot,t),'clientes',coalesce(f.cliente_snapshot,c),'perfiles',coalesce(f.vendedor_snapshot,v)), 'items',its,'tienda',coalesce(f.tienda_snapshot,t),'identidad_historica',f.tienda_snapshot is not null,'plantillas',t->'plantillas_factura');
end $$;

$message_document$;
 end if;
end $upgrade$;
commit;
