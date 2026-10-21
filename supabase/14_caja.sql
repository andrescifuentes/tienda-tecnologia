-- PREPARADO LOCALMENTE. NO EJECUTADO EN REMOTO.
-- Requiere SQL10_multi_negocio y15_datos_empresa aplicados antes.
-- Revisar con el administrador en staging. No modifica facturas, movimientos,
-- inventario ni RLS existente. Añade un libro operativo independiente.
begin;
create table if not exists public.caja_sesiones (
 id bigint generated always as identity primary key,
 negocio_id integer not null references public.tienda(id),
 responsable_id uuid not null references public.perfiles(id),
 responsable_nombre text not null,
 apertura_en timestamptz not null default clock_timestamp(),
 estado text not null default 'abierta' check(estado in('abierta','cerrada')),
 inicial_cent bigint not null check(inicial_cent between 0 and 9007199254740991),
 revision bigint not null default 0,
 request_id text not null,
 cierre_en timestamptz,
 cerrado_por uuid references public.perfiles(id),
 cerrado_nombre text,
 contado_cent bigint check(contado_cent between 0 and 9007199254740991),
 diferencia_cent bigint,
 observaciones text,
 resumen_cierre jsonb,
 cierre_request_id text,
 unique(id,negocio_id),
 unique(negocio_id,responsable_id,request_id),
 check((estado='abierta' and cierre_en is null and contado_cent is null) or
       (estado='cerrada' and cierre_en is not null and contado_cent is not null and resumen_cierre is not null))
);
create unique index if not exists caja_una_abierta on public.caja_sesiones(negocio_id,responsable_id) where estado='abierta';
create table if not exists public.caja_eventos (
 id bigint generated always as identity primary key,
 negocio_id integer not null references public.tienda(id),
 caja_id bigint not null,
 foreign key(caja_id,negocio_id) references public.caja_sesiones(id,negocio_id),
 tipo text not null check(tipo in('venta','devolucion','anulacion','entrada','salida','gasto','pago_proveedor','reembolso')),
 metodo text not null check(metodo in('efectivo','tarjeta','transferencia')),
 monto_cent bigint not null check(abs(monto_cent::numeric)<=9007199254740991),
 efectivo_cent bigint not null check(abs(efectivo_cent::numeric)<=9007199254740991),
 descripcion text not null,
 referencia text not null,
 origen text,
 unique(negocio_id,origen),
 origen_id bigint,
 ajuste_id bigint unique references public.caja_eventos(id),
 creado_por uuid not null references public.perfiles(id),
 fecha timestamptz not null default clock_timestamp(),
 request_id text,
 unique(caja_id,request_id),
 check(metodo='efectivo' or efectivo_cent=0),
 check(tipo not in('devolucion','anulacion') or efectivo_cent=0)
);
create index if not exists caja_eventos_sesion on public.caja_eventos(caja_id,id);
alter table public.caja_sesiones enable row level security;
alter table public.caja_eventos enable row level security;
drop policy if exists caja_sesiones_select on public.caja_sesiones;
create policy caja_sesiones_select on public.caja_sesiones for select to authenticated using(negocio_id=public.mi_negocio() and public.es_activo() and(public.es_admin() or responsable_id=auth.uid()));
drop policy if exists caja_eventos_select on public.caja_eventos;
create policy caja_eventos_select on public.caja_eventos for select to authenticated using(negocio_id=public.mi_negocio() and public.es_activo() and exists(select 1 from public.caja_sesiones s where s.id=caja_id and s.negocio_id=public.mi_negocio() and(public.es_admin() or s.responsable_id=auth.uid())));
revoke all on public.caja_sesiones,public.caja_eventos from public,anon,authenticated;
grant select on public.caja_sesiones,public.caja_eventos to authenticated;

create or replace function public._caja_resumen(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare s public.caja_sesiones%rowtype; r jsonb; expected numeric;
begin
 select * into strict s from public.caja_sesiones where id=p_id and negocio_id=public.mi_negocio();
 select s.inicial_cent::numeric+coalesce(sum(efectivo_cent),0) into expected from public.caja_eventos where caja_id=p_id;
 if abs(expected)>9007199254740991 then raise exception 'El total supera el límite seguro de caja'; end if;
 select jsonb_build_object(
  'ventas',jsonb_build_object('efectivo',coalesce(sum(monto_cent)filter(where tipo='venta' and metodo='efectivo'),0),'tarjeta',coalesce(sum(monto_cent)filter(where tipo='venta' and metodo='tarjeta'),0),'transferencia',coalesce(sum(monto_cent)filter(where tipo='venta' and metodo='transferencia'),0)),
  'vendido_bruto_cent',coalesce(sum(monto_cent)filter(where tipo='venta'),0),
  'ajustes_cent',coalesce(sum(monto_cent)filter(where tipo in('devolucion','anulacion')),0),
  'efectivo_esperado_cent',expected,'eventos',count(*),
  'reembolsos_por_confirmar',(select count(*) from public.caja_eventos a where a.caja_id=p_id and a.tipo in('devolucion','anulacion') and not exists(select 1 from public.caja_eventos b where b.ajuste_id=a.id))
 )into r from public.caja_eventos where caja_id=p_id;
 -- All JSON amounts consumed by JS must remain safe integer centavos.
 if abs((r->>'vendido_bruto_cent')::numeric)>9007199254740991 or abs((r->>'ajustes_cent')::numeric)>9007199254740991 then raise exception 'El total supera el límite seguro de caja'; end if;
 return r;
end $$;

create or replace function public._caja_validar() returns uuid
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or public.mi_negocio() is null or not exists(select 1 from public.tienda t where t.id=public.mi_negocio() and t.activo) or not public.es_activo() or not public.tiene_permiso('vender') then raise exception using errcode='42501',message='No tienes permiso para operar caja'; end if;
 return auth.uid();
end $$;
create or replace function public.caja_estado(p_caja_id bigint default null,p_antes_id bigint default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid; s public.caja_sesiones%rowtype; active_row jsonb; history_rows jsonb; event_rows jsonb; allowed_count bigint;
begin
 actor:=public._caja_validar();
 select to_jsonb(c) into active_row from public.caja_sesiones c where c.negocio_id=public.mi_negocio() and c.responsable_id=actor and c.estado='abierta';
 if p_caja_id is not null then
  select * into s from public.caja_sesiones where id=p_caja_id and negocio_id=public.mi_negocio();
  if not found or not(public.es_admin() or s.responsable_id=actor)then raise exception using errcode='42501',message='No tienes permiso para esta caja'; end if;
 else select * into s from public.caja_sesiones where negocio_id=public.mi_negocio() and responsable_id=actor and estado='abierta'; end if;
 select jsonb_agg(to_jsonb(c) order by c.id desc) into history_rows from(select * from public.caja_sesiones where negocio_id=public.mi_negocio() and(public.es_admin() or responsable_id=actor)and(p_antes_id is null or id<p_antes_id)order by id desc limit 30)c;
 select count(*) into allowed_count from public.caja_sesiones where negocio_id=public.mi_negocio() and(public.es_admin() or responsable_id=actor)and(p_antes_id is null or id<p_antes_id);
 select jsonb_agg(to_jsonb(e) order by e.id desc) into event_rows from(select * from public.caja_eventos where caja_id=s.id order by id desc limit 100)e;
 return jsonb_build_object('version',1,'active',active_row,'session',case when s.id is not null then to_jsonb(s)else null end,'history',coalesce(history_rows,'[]'::jsonb),'history_limited',allowed_count>30,'pending_adjustments',coalesce((select jsonb_agg(to_jsonb(a) order by a.id)from(select e.* from public.caja_eventos e where e.caja_id=s.id and e.tipo in('devolucion','anulacion')and not exists(select 1 from public.caja_eventos p where p.ajuste_id=e.id)order by e.id limit 100)a),'[]'::jsonb),'events',coalesce(event_rows,'[]'::jsonb),'events_limited',(select count(*)>100 from public.caja_eventos where caja_id=s.id),'summary',case when s.id is null then null else coalesce(s.resumen_cierre,public._caja_resumen(s.id))end);
end $$;

create or replace function public.caja_abrir(p_inicial_cent bigint,p_request_id text)returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid; previous_id bigint; nombre text; result_id bigint;
begin
 actor:=public._caja_validar();
 if p_request_id is null or p_request_id!~'^[A-Za-z0-9-]{8,100}$' or p_inicial_cent is null or p_inicial_cent<0 or p_inicial_cent>9007199254740991 then raise exception 'Saldo inicial o identificador inválido'; end if;
 perform pg_advisory_xact_lock(hashtextextended('caja:'||public.mi_negocio()::text||':'||actor::text,0));
 select id into previous_id from public.caja_sesiones where negocio_id=public.mi_negocio() and responsable_id=actor and request_id=p_request_id;
 if found then return previous_id; end if;
 if exists(select 1 from public.caja_sesiones where negocio_id=public.mi_negocio() and responsable_id=actor and estado='abierta')then raise exception 'Ya tienes una caja abierta'; end if;
 select p.nombre into nombre from public.perfiles p where p.id=actor and p.negocio_id=public.mi_negocio();
 insert into public.caja_sesiones(negocio_id,responsable_id,responsable_nombre,inicial_cent,request_id)values(public.mi_negocio(),actor,nombre,p_inicial_cent,p_request_id)returning id into result_id;
 perform public.registrar_actividad('caja.apertura','caja_sesiones',result_id::text,jsonb_build_object('inicial_cent',p_inicial_cent));
 return result_id;
end $$;

create or replace function public.caja_movimiento(p_caja_id bigint,p_request_id text,p_tipo text,p_monto_cent bigint,p_metodo text,p_descripcion text,p_referencia text,p_ajuste_id bigint default null)returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid;s public.caja_sesiones%rowtype;a public.caja_eventos%rowtype;result_id bigint; signed_value bigint;
begin
 actor:=public._caja_validar();
 select * into s from public.caja_sesiones where id=p_caja_id and negocio_id=public.mi_negocio();
 if not found or not(public.es_admin() or s.responsable_id=actor)then raise exception using errcode='42501',message='No tienes permiso para esta caja'; end if;
 perform pg_advisory_xact_lock(hashtextextended('caja:'||s.negocio_id::text||':'||s.responsable_id::text,0));
 select * into s from public.caja_sesiones where id=p_caja_id and negocio_id=public.mi_negocio() for update;
 select id into result_id from public.caja_eventos where caja_id=p_caja_id and request_id=p_request_id;
 if found then return result_id; end if;
 if s.estado<>'abierta'then raise exception 'La caja está cerrada';end if;
 if p_request_id is null or p_request_id!~'^[A-Za-z0-9-]{8,100}$' or p_tipo is null or p_tipo not in('entrada','salida','gasto','pago_proveedor','reembolso')or p_monto_cent is null or p_monto_cent<=0 or p_monto_cent>9007199254740991 or p_metodo is null or p_metodo not in('efectivo','tarjeta','transferencia')or(p_tipo<>'reembolso' and p_metodo<>'efectivo')then raise exception 'Movimiento o importe inválido'; end if;
 if coalesce(length(trim(p_descripcion)),0)not between 1 and 500 or coalesce(length(trim(p_referencia)),0)not between 1 and 120 then raise exception 'Motivo y referencia obligatorios';end if;
 if p_tipo='reembolso'then
  select * into a from public.caja_eventos where id=p_ajuste_id and caja_id=s.id and tipo in('devolucion','anulacion');
  if not found or abs(a.monto_cent)<>p_monto_cent or exists(select 1 from public.caja_eventos where ajuste_id=a.id)then raise exception 'Selecciona un ajuste pendiente y su importe exacto; no puede pagarse dos veces';end if;
 elsif p_ajuste_id is not null then raise exception 'Referencia de ajuste inválida';end if;
 signed_value:=case when p_tipo='entrada'then p_monto_cent else -p_monto_cent end;
 insert into public.caja_eventos(negocio_id,caja_id,tipo,metodo,monto_cent,efectivo_cent,descripcion,referencia,ajuste_id,creado_por,request_id)
 values(s.negocio_id,s.id,p_tipo,p_metodo,signed_value,case when p_metodo='efectivo'then signed_value else 0 end,trim(p_descripcion),trim(p_referencia),p_ajuste_id,actor,p_request_id)returning id into result_id;
 update public.caja_sesiones set revision=revision+1 where id=s.id;
 perform public._caja_resumen(s.id);
 perform public.registrar_actividad('caja.movimiento','caja_sesiones',s.id::text,jsonb_build_object('evento_id',result_id,'tipo',p_tipo));
 return result_id;
end $$;

create or replace function public.caja_cerrar(p_caja_id bigint,p_request_id text,p_revision bigint,p_contado_cent bigint,p_observaciones text default '')returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid;s public.caja_sesiones%rowtype;summary jsonb;difference bigint;nombre text;
begin
 actor:=public._caja_validar();
 select * into s from public.caja_sesiones where id=p_caja_id and negocio_id=public.mi_negocio();
 if not found or not(public.es_admin() or s.responsable_id=actor)then raise exception using errcode='42501',message='No tienes permiso para esta caja';end if;
 perform pg_advisory_xact_lock(hashtextextended('caja:'||s.negocio_id::text||':'||s.responsable_id::text,0));
 select * into s from public.caja_sesiones where id=p_caja_id and negocio_id=public.mi_negocio() for update;
 if s.cierre_request_id=p_request_id then return s.id;end if;
 if s.estado<>'abierta'then raise exception 'La caja ya está cerrada';end if;
 if p_request_id is null or p_request_id!~'^[A-Za-z0-9-]{8,100}$' or p_contado_cent is null or p_contado_cent<0 or p_contado_cent>9007199254740991 or p_revision is distinct from s.revision then raise exception 'La caja recibió movimientos nuevos o los datos de cierre no son válidos. Actualiza y revisa el efectivo antes de cerrar';end if;
 summary:=public._caja_resumen(s.id);
 difference:=p_contado_cent-(summary->>'efectivo_esperado_cent')::bigint;
 if abs(difference::numeric)>9007199254740991 then raise exception 'La diferencia supera el límite seguro';end if;
 if length(coalesce(p_observaciones,''))>1000 or(difference<>0 and coalesce(trim(p_observaciones),'')='')then raise exception 'Explica el sobrante o faltante en observaciones';end if;
 select p.nombre into nombre from public.perfiles p where p.id=actor;
 update public.caja_sesiones set estado='cerrada',cierre_en=clock_timestamp(),cerrado_por=actor,cerrado_nombre=nombre,contado_cent=p_contado_cent,diferencia_cent=difference,observaciones=trim(p_observaciones),resumen_cierre=summary,cierre_request_id=p_request_id where id=s.id;
 perform public.registrar_actividad('caja.cierre','caja_sesiones',s.id::text,jsonb_build_object('contado_cent',p_contado_cent,'diferencia_cent',difference));
 return s.id;
end $$;

-- Serialize sale/refund capture against open/close using the same actor lock.
-- No open drawer => the preexisting sale flow continues without fabricating a drawer.
create or replace function public._caja_capturar(p_negocio_id integer,p_tipo text,p_method text,p_value numeric,p_source_id bigint,p_reference text)returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid();s public.caja_sesiones%rowtype;cent bigint;source_key text;
begin
 if actor is null or p_value<=0 then return;end if;
 if p_negocio_id is distinct from public.mi_negocio() then raise exception using errcode='42501',message='El movimiento no pertenece al negocio autorizado';end if;
 perform pg_advisory_xact_lock(hashtextextended('caja:'||public.mi_negocio()::text||':'||actor::text,0));
 select * into s from public.caja_sesiones where negocio_id=public.mi_negocio() and responsable_id=actor and estado='abierta' for update;
 if not found then return;end if;
 if p_value*100<>trunc(p_value*100)or p_value*100>9007199254740991 then raise exception 'Importe de caja fuera de rango';end if;
 cent:=(p_value*100)::bigint;source_key:=p_tipo||':'||p_source_id::text;
 if exists(select 1 from public.caja_eventos where negocio_id=p_negocio_id and origen=source_key)then return;end if;
 insert into public.caja_eventos(negocio_id,caja_id,tipo,metodo,monto_cent,efectivo_cent,descripcion,referencia,origen,origen_id,creado_por)
 values(s.negocio_id,s.id,p_tipo,p_method,case when p_tipo='venta'then cent else -cent end,case when p_tipo='venta'and p_method='efectivo'then cent else 0 end,case when p_tipo='venta'then 'Venta confirmada'else 'Ajuste comercial; confirma el reembolso realizado'end,p_reference,source_key,p_source_id,actor);
 update public.caja_sesiones set revision=revision+1 where id=s.id;
 perform public._caja_resumen(s.id);
end $$;
create or replace function public._caja_factura_trigger()returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare remainder numeric;
begin
 if new.estado='emitida'and new.total>0 then perform public._caja_capturar(new.negocio_id,'venta',new.metodo_pago::text,new.total,new.id,new.prefijo||'-'||new.numero::text);
 elsif tg_op='UPDATE'then
  if old.estado='emitida'and new.estado='anulada'then
   select greatest(0,new.total-coalesce(sum(total_devuelto),0))into remainder from public.devoluciones where factura_id=new.id;
   perform public._caja_capturar(new.negocio_id,'anulacion',new.metodo_pago::text,remainder,new.id,new.prefijo||'-'||new.numero::text);
  end if;
 end if;
 return new;
end $$;
create or replace function public._caja_devolucion_trigger()returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.facturas%rowtype;
begin
 if new.total_devuelto>0 then
  select * into strict f from public.facturas where id=new.factura_id;
  perform public._caja_capturar(f.negocio_id,'devolucion',f.metodo_pago::text,new.total_devuelto,new.id,'Devolución '||new.id::text||' · '||f.prefijo||'-'||f.numero::text);
 end if;
 return new;
end $$;
drop trigger if exists caja_capturar_factura on public.facturas;
create trigger caja_capturar_factura after insert or update of estado,total on public.facturas for each row execute function public._caja_factura_trigger();
drop trigger if exists caja_capturar_devolucion on public.devoluciones;
create trigger caja_capturar_devolucion after insert or update of total_devuelto on public.devoluciones for each row execute function public._caja_devolucion_trigger();

revoke all on function public._caja_resumen(bigint),public._caja_validar(),public._caja_capturar(integer,text,text,numeric,bigint,text),public._caja_factura_trigger(),public._caja_devolucion_trigger()from public,anon,authenticated;
revoke all on function public.caja_estado(bigint,bigint),public.caja_abrir(bigint,text),public.caja_movimiento(bigint,text,text,bigint,text,text,text,bigint),public.caja_cerrar(bigint,text,bigint,bigint,text)from public,anon;
grant execute on function public.caja_estado(bigint,bigint),public.caja_abrir(bigint,text),public.caja_movimiento(bigint,text,text,bigint,text,text,text,bigint),public.caja_cerrar(bigint,text,bigint,bigint,text)to authenticated;
notify pgrst,'reload schema';
commit;
