-- PREPARADO LOCALMENTE. NO EJECUTADO EN REMOTO.
-- Medios de transferencia con código QR (Nequi, Daviplata, bancos...) por negocio.
-- Requiere 10_multi_negocio.sql (mi_negocio, tienda.id integer) aplicado antes.
-- No cambia emitir_factura ni emitir_factura_segura: el medio se registra después
-- de confirmar la venta y solo en facturas pagadas por transferencia.
-- Las imágenes se guardan como data URL PNG/JPG validadas (como el logo de empresa).
begin;

create or replace function public.imagen_data_url_valida(p text, p_max_bytes integer) returns boolean
language plpgsql immutable set search_path = pg_catalog, public as $$
begin
  if p is null then return true; end if;
  if p !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$' then return false; end if;
  if not (p like 'data:image/png;base64,iVBORw0KGgo%' or p like 'data:image/jpeg;base64,/9j/%') then return false; end if;
  begin
    return octet_length(decode(split_part(p, ',', 2), 'base64')) <= p_max_bytes;
  exception when others then return false;
  end;
end $$;

create or replace function public.medio_transferencia_valido(p_nombre text, p_titular text, p_cuenta text, p_detalle text, p_logo text, p_qr text) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(length(trim(p_nombre)), 0) between 1 and 60
     and coalesce(length(p_titular), 0) <= 100
     and coalesce(length(p_cuenta), 0) <= 60
     and coalesce(length(p_detalle), 0) <= 200
     and coalesce(p_nombre, '') || coalesce(p_titular, '') || coalesce(p_cuenta, '') || coalesce(p_detalle, '') !~ '[[:cntrl:]]'
     and p_qr is not null
     and public.imagen_data_url_valida(p_qr, 307200)
     and public.imagen_data_url_valida(p_logo, 102400)
$$;

create table if not exists public.medios_transferencia (
  id              bigint generated always as identity primary key,
  negocio_id      integer not null default public.mi_negocio() references public.tienda(id),
  nombre          text not null,
  titular         text,
  numero_cuenta   text,
  detalle         text,
  logo_data_url   text,
  qr_data_url     text not null,
  activo          boolean not null default true,
  orden           integer not null default 0 check (orden between 0 and 9999),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references public.perfiles(id),
  constraint medios_transferencia_validos check (public.medio_transferencia_valido(nombre, titular, numero_cuenta, detalle, logo_data_url, qr_data_url))
);
create unique index if not exists medios_transferencia_nombre_uq on public.medios_transferencia (negocio_id, lower(nombre));
create index if not exists medios_transferencia_orden on public.medios_transferencia (negocio_id, activo, orden, id);

-- El negocio lo fija el servidor y no se puede mover; se audita quién cambió el QR.
create or replace function public.medios_transferencia_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.negocio_id := public.mi_negocio();
    if new.negocio_id is null then raise exception using errcode = '42501', message = 'No tienes un negocio activo'; end if;
    new.creado_en := now();
  elsif new.negocio_id is distinct from old.negocio_id or new.creado_en is distinct from old.creado_en then
    raise exception 'No se puede cambiar el negocio de un medio de pago';
  end if;
  new.nombre := trim(new.nombre);
  new.titular := nullif(trim(coalesce(new.titular, '')), '');
  new.numero_cuenta := nullif(trim(coalesce(new.numero_cuenta, '')), '');
  new.detalle := nullif(trim(coalesce(new.detalle, '')), '');
  new.logo_data_url := nullif(new.logo_data_url, '');
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end $$;
drop trigger if exists medios_transferencia_guard on public.medios_transferencia;
create trigger medios_transferencia_guard before insert or update on public.medios_transferencia
  for each row execute function public.medios_transferencia_guard();

alter table public.medios_transferencia enable row level security;
drop policy if exists medios_transferencia_select on public.medios_transferencia;
drop policy if exists medios_transferencia_insert on public.medios_transferencia;
drop policy if exists medios_transferencia_update on public.medios_transferencia;
drop policy if exists medios_transferencia_delete on public.medios_transferencia;
-- Vendedores: solo consultan medios activos de su negocio. Administrador: todo su negocio.
create policy medios_transferencia_select on public.medios_transferencia for select to authenticated
  using (negocio_id = (select public.mi_negocio()) and public.es_activo() and (public.es_admin() or (activo and public.tiene_permiso('vender'))));
create policy medios_transferencia_insert on public.medios_transferencia for insert to authenticated
  with check (negocio_id = (select public.mi_negocio()) and public.es_admin());
create policy medios_transferencia_update on public.medios_transferencia for update to authenticated
  using (negocio_id = (select public.mi_negocio()) and public.es_admin())
  with check (negocio_id = (select public.mi_negocio()) and public.es_admin());
create policy medios_transferencia_delete on public.medios_transferencia for delete to authenticated
  using (negocio_id = (select public.mi_negocio()) and public.es_admin());
revoke all on public.medios_transferencia from public, anon, authenticated;
grant select, insert, update, delete on public.medios_transferencia to authenticated;

-- Referencia histórica en la factura: id + nombre congelado. Un medio usado en
-- ventas no se puede borrar (on delete restrict); se desactiva.
alter table public.facturas add column if not exists medio_transferencia_id bigint;
alter table public.facturas add column if not exists medio_transferencia jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'facturas_medio_transferencia_fk') then
    alter table public.facturas add constraint facturas_medio_transferencia_fk
      foreign key (medio_transferencia_id) references public.medios_transferencia(id) on delete restrict;
  end if;
end $$;
create index if not exists idx_facturas_medio_transferencia on public.facturas (medio_transferencia_id) where medio_transferencia_id is not null;

-- Se llama tras una venta confirmada. No cobra, no emite y no cambia importes.
-- Solo una vez por factura; repetir con el mismo medio es idempotente.
create or replace function public.factura_registrar_medio_transferencia(p_factura_id bigint, p_medio_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare f public.facturas%rowtype; m public.medios_transferencia%rowtype; snapshot jsonb;
begin
  if auth.uid() is null or public.mi_negocio() is null or not public.es_activo() or not public.tiene_permiso('vender') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar el medio de pago';
  end if;
  select * into f from public.facturas where id = p_factura_id and negocio_id = public.mi_negocio() for update;
  if not found or not (public.es_admin() or f.vendedor_id = auth.uid()) then
    raise exception using errcode = '42501', message = 'No tienes permiso sobre esta factura';
  end if;
  if f.metodo_pago <> 'transferencia' then raise exception 'La factura no se cobró por transferencia'; end if;
  select * into m from public.medios_transferencia where id = p_medio_id and negocio_id = public.mi_negocio();
  if not found then raise exception 'El medio de transferencia no existe'; end if;
  if f.medio_transferencia_id is not null then
    if f.medio_transferencia_id = m.id then return f.medio_transferencia; end if;
    raise exception 'La factura ya tiene registrado otro medio de transferencia';
  end if;
  if not m.activo then raise exception 'El medio de transferencia está desactivado'; end if;
  if f.estado <> 'emitida' then raise exception 'La factura no está vigente'; end if;
  snapshot := jsonb_build_object('id', m.id, 'nombre', m.nombre);
  update public.facturas set medio_transferencia_id = m.id, medio_transferencia = snapshot where id = f.id;
  perform public.registrar_actividad('factura.medio_transferencia', 'facturas', f.id::text, snapshot);
  return snapshot;
end $$;

revoke all on function public.imagen_data_url_valida(text, integer) from public, anon;
revoke all on function public.medio_transferencia_valido(text, text, text, text, text, text) from public, anon;
grant execute on function public.imagen_data_url_valida(text, integer) to authenticated;
grant execute on function public.medio_transferencia_valido(text, text, text, text, text, text) to authenticated;
revoke all on function public.medios_transferencia_guard() from public, anon, authenticated;
revoke all on function public.factura_registrar_medio_transferencia(bigint, bigint) from public, anon;
grant execute on function public.factura_registrar_medio_transferencia(bigint, bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
