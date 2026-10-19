-- Local preparation only. Review and apply with separate authorization.
-- New service-only mail records; existing invoice/RLS policies are unchanged.
begin;
alter table public.tienda alter column nombre set default 'Angie Tech';
alter table public.tienda add column if not exists nombre_personalizado boolean not null default false;
create or replace function public.correo_nombre_personalizado() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.nombre is distinct from old.nombre then new.nombre_personalizado=true; end if;
 return new;
end $$;
drop trigger if exists correo_nombre_explicito on public.tienda;
create trigger correo_nombre_explicito before update of nombre on public.tienda for each row execute function public.correo_nombre_personalizado();
alter table public.facturas add column if not exists cliente_snapshot jsonb;
alter table public.facturas add column if not exists vendedor_snapshot jsonb;
alter table public.facturas add column if not exists tienda_snapshot jsonb;
alter table public.factura_items add column if not exists codigo text;
alter table public.factura_items add column if not exists serial text;

create or replace function public.correo_congelar_factura() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- Always source future historical identity from the database, not caller JSON.
  select jsonb_build_object('nombre',c.nombre,'tipo_documento',c.tipo_documento,'documento',c.documento,'telefono',c.telefono,'correo',c.correo,'direccion',c.direccion) into new.cliente_snapshot from clientes c where c.id=new.cliente_id;
  select jsonb_build_object('nombre',p.nombre) into new.vendedor_snapshot from perfiles p where p.id=new.vendedor_id;
  select to_jsonb(t) - 'ultimo_numero_factura' into new.tienda_snapshot from tienda t where t.id=coalesce((to_jsonb(new)->>'negocio_id')::bigint,1);
  return new;
end $$;
create or replace function public.correo_congelar_item() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  select p.codigo into new.codigo from productos p where p.id=new.producto_id;
  select u.serial into new.serial from unidades_serializadas u where u.id=new.unidad_id;
  return new;
end $$;
drop trigger if exists correo_factura_identidad on public.facturas;
create trigger correo_factura_identidad before insert on public.facturas for each row execute function public.correo_congelar_factura();
drop trigger if exists correo_item_identidad on public.factura_items;
create trigger correo_item_identidad before insert on public.factura_items for each row execute function public.correo_congelar_item();

create table if not exists public.factura_correo_envios (
 id uuid primary key default gen_random_uuid(), factura_id bigint not null references public.facturas(id),
 actor_id uuid not null references public.perfiles(id), destino text not null,
 estado text not null default 'preparando' check(estado in ('preparando','enviando','aceptado','error','incierto')),
 proveedor_id text, error_codigo text, payload jsonb, intentos integer not null default 0,
 lock_token uuid, lock_hasta timestamptz, proveedor_inicio timestamptz,
 creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now(),
 unique(factura_id,destino)
);
create table if not exists public.factura_correo_intentos (
 id bigint generated always as identity primary key, envio_id uuid not null references public.factura_correo_envios(id),
 actor_id uuid not null references public.perfiles(id), fecha timestamptz not null default now()
);
create index if not exists correo_intentos_actor_fecha on public.factura_correo_intentos(actor_id,fecha);
alter table public.factura_correo_envios enable row level security;
alter table public.factura_correo_intentos enable row level security;
revoke all on public.factura_correo_envios,public.factura_correo_intentos from anon,authenticated;
grant all on public.factura_correo_envios,public.factura_correo_intentos to service_role;
grant usage,select on sequence public.factura_correo_intentos_id_seq to service_role;

create or replace function public.correo_factura_documento(p_actor uuid,p_factura bigint) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare f facturas%rowtype; pf perfiles%rowtype; c jsonb; v jsonb; t jsonb; its jsonb;
begin
 select * into pf from perfiles where id=p_actor;
 if not found or not pf.activo then raise exception 'FORBIDDEN'; end if;
 select * into f from facturas where id=p_factura;
 if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
 if (to_jsonb(pf)->>'negocio_id') is distinct from (to_jsonb(f)->>'negocio_id') then raise exception 'FORBIDDEN'; end if;
 if pf.rol<>'admin' and (f.vendedor_id<>p_actor or not exists(select 1 from perfil_permisos where perfil_id=p_actor and permiso='vender')) then raise exception 'FORBIDDEN'; end if;
 if f.estado<>'emitida' then raise exception 'INVOICE_NOT_ISSUED'; end if;
 select to_jsonb(cl) into c from clientes cl where cl.id=f.cliente_id;
 select jsonb_build_object('nombre',p.nombre) into v from perfiles p where p.id=f.vendedor_id;
 select to_jsonb(s)-'ultimo_numero_factura' into t from tienda s where s.id=coalesce((to_jsonb(f)->>'negocio_id')::bigint,1) and coalesce((to_jsonb(s)->>'activo')::boolean,true);
 if not found then raise exception 'FORBIDDEN'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'nombre',i.nombre,'cantidad',i.cantidad,'precio_unitario',i.precio_unitario,'descuento',i.descuento,'codigo',coalesce(i.codigo,p.codigo),'serial',coalesce(i.serial,u.serial)) order by i.id),'[]'::jsonb) into its from factura_items i left join productos p on p.id=i.producto_id left join unidades_serializadas u on u.id=i.unidad_id where i.factura_id=f.id;
 -- Older invoices have historical line amounts but no original identity snapshot.
 -- Prefer snapshots; fallback identity is explicitly flagged, never invented.
 return jsonb_build_object('invoice',(to_jsonb(f)-'costo_total'-'comision'-'comision_pct')||jsonb_build_object('cliente_snapshot',coalesce(f.cliente_snapshot,c),'vendedor_snapshot',coalesce(f.vendedor_snapshot,v),'tienda_snapshot',coalesce(f.tienda_snapshot,t),'clientes',coalesce(f.cliente_snapshot,c),'perfiles',coalesce(f.vendedor_snapshot,v)), 'items',its,'tienda',coalesce(f.tienda_snapshot,t),'identidad_historica',f.tienda_snapshot is not null,'plantillas',t->'plantillas_factura');
end $$;

create or replace function public.correo_factura_reservar(p_actor uuid,p_factura bigint,p_destino text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r factura_correo_envios%rowtype;
begin
 perform correo_factura_documento(p_actor,p_factura);
 if length(p_destino)>254 or p_destino !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'INVALID_EMAIL'; end if;
 perform pg_advisory_xact_lock(hashtextextended('correo-factura:'||p_factura::text,0));
 select * into r from factura_correo_envios where factura_id=p_factura and destino=lower(trim(p_destino));
 if not found then
  if (select count(*) from factura_correo_envios where factura_id=p_factura and creado_en>now()-interval '24 hours')>=3 then raise exception 'RATE_LIMIT'; end if;
  insert into factura_correo_envios(factura_id,actor_id,destino) values(p_factura,p_actor,lower(trim(p_destino))) returning * into r;
 end if;
 return to_jsonb(r);
end $$;

create or replace function public.correo_factura_tomar(p_actor uuid,p_envio uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r factura_correo_envios%rowtype;
begin
 select * into r from factura_correo_envios where id=p_envio for update;
 if not found then raise exception 'SEND_NOT_FOUND'; end if;
 perform correo_factura_documento(p_actor,r.factura_id);
 if r.estado='aceptado' then return to_jsonb(r); end if;
 if r.lock_hasta>now() then raise exception 'SEND_IN_PROGRESS'; end if;
 if r.proveedor_inicio is not null and r.proveedor_inicio<now()-interval '23 hours' then raise exception 'MANUAL_REVIEW_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('correo-actor:'||p_actor::text,0));
 if (select count(*) from factura_correo_intentos where actor_id=p_actor and fecha>now()-interval '1 minute')>=5 or (select count(*) from factura_correo_intentos where actor_id=p_actor and fecha>now()-interval '24 hours')>=30 then raise exception 'RATE_LIMIT'; end if;
 update factura_correo_envios set estado='preparando',lock_token=gen_random_uuid(),lock_hasta=now()+interval '90 seconds',intentos=intentos+1,actor_id=p_actor,actualizado_en=now() where id=r.id returning * into r;
 insert into factura_correo_intentos(envio_id,actor_id) values(r.id,p_actor);
 return to_jsonb(r);
end $$;

create or replace function public.correo_factura_payload(p_envio uuid,p_lock uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r factura_correo_envios%rowtype;
begin
 if octet_length(p_payload::text)>4500000 then raise exception 'ATTACHMENT_TOO_LARGE'; end if;
 update factura_correo_envios set payload=coalesce(payload,p_payload),actualizado_en=now() where id=p_envio and lock_token=p_lock and lock_hasta>now() returning * into r;
 if not found then raise exception 'SEND_IN_PROGRESS'; end if;
 return r.payload;
end $$;
create or replace function public.correo_factura_iniciar(p_envio uuid,p_lock uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update factura_correo_envios set estado='enviando',proveedor_inicio=coalesce(proveedor_inicio,now()),actualizado_en=now() where id=p_envio and lock_token=p_lock and lock_hasta>now() and payload is not null;
 if not found then raise exception 'SEND_IN_PROGRESS'; end if;
end $$;
create or replace function public.correo_factura_finalizar(p_envio uuid,p_lock uuid,p_estado text,p_proveedor text default null,p_codigo text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r factura_correo_envios%rowtype;
begin
 if p_estado not in ('aceptado','error','incierto') or (p_estado='aceptado' and coalesce(p_proveedor,'')='') then raise exception 'INVALID_STATUS'; end if;
 update factura_correo_envios set estado=p_estado,proveedor_id=p_proveedor,error_codigo=p_codigo,lock_token=null,lock_hasta=null,actualizado_en=now() where id=p_envio and lock_token=p_lock returning * into r;
 if not found then raise exception 'SEND_IN_PROGRESS'; end if;
 if p_estado='aceptado' then insert into factura_envios(factura_id,canal,destino,enviado_por) values(r.factura_id,'correo',r.destino,r.actor_id); end if;
end $$;

-- Every privileged operation is callable exclusively by the Edge Function.
revoke all on function public.correo_nombre_personalizado(),public.correo_congelar_factura(),public.correo_congelar_item(),public.correo_factura_documento(uuid,bigint),public.correo_factura_reservar(uuid,bigint,text),public.correo_factura_tomar(uuid,uuid),public.correo_factura_payload(uuid,uuid,jsonb),public.correo_factura_iniciar(uuid,uuid),public.correo_factura_finalizar(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.correo_factura_documento(uuid,bigint),public.correo_factura_reservar(uuid,bigint,text),public.correo_factura_tomar(uuid,uuid),public.correo_factura_payload(uuid,uuid,jsonb),public.correo_factura_iniciar(uuid,uuid),public.correo_factura_finalizar(uuid,uuid,text,text,text) to service_role;
commit;
