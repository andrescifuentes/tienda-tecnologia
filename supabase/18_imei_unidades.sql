-- PREPARADO LOCALMENTE. NO EJECUTADO EN REMOTO.
-- IMEI y datos adicionales SIN tabla paralela: reutiliza productos.maneja_serial y
-- unidades_serializadas (serial único por negocio desde 10_multi_negocio.sql).
-- Requiere 10_multi_negocio.sql. Columnas nuevas opcionales; filas existentes intactas:
-- los seriales anteriores no se revalidan salvo que se cambien.
begin;
alter table public.productos add column if not exists tipo_serial text;
alter table public.productos add column if not exists atributos jsonb not null default '[]'::jsonb;
alter table public.unidades_serializadas add column if not exists atributos jsonb not null default '{}'::jsonb;

create or replace function public.imei_valido(p text) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare s int := 0; n int; i int;
begin
  if p is null or p !~ '^[0-9]{15}$' then return false; end if;
  for i in 0..14 loop
    n := substr(p, 15 - i, 1)::int;
    if i % 2 = 1 then n := n * 2; if n > 9 then n := n - 9; end if; end if;
    s := s + n;
  end loop;
  return s % 10 = 0;
end $$;

create or replace function public.producto_atributos_validos(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 10
     and not exists (select 1 from jsonb_array_elements(p) e
                      where jsonb_typeof(e) <> 'object' or (e - array['etiqueta', 'valor']) <> '{}'::jsonb
                         or jsonb_typeof(e->'etiqueta') <> 'string' or jsonb_typeof(e->'valor') <> 'string'
                         or length(e->>'etiqueta') not between 1 and 40 or length(e->>'valor') not between 1 and 120
                         or (e->>'etiqueta') || (e->>'valor') ~ '[[:cntrl:]]')
$$;
create or replace function public.unidad_atributos_validos(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select jsonb_typeof(p) = 'object'
     and (p - array['imei2', 'color', 'capacidad', 'nota']) = '{}'::jsonb
     and not exists (select 1 from jsonb_each(p) e where jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') not between 1 and case when e.key = 'nota' then 200 else 60 end or (e.value #>> '{}') ~ '[[:cntrl:]]')
     and (not p ? 'imei2' or public.imei_valido(p->>'imei2'))
$$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'productos_tipo_serial_check') then
    alter table public.productos add constraint productos_tipo_serial_check check (tipo_serial is null or tipo_serial in ('imei', 'serie'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'productos_atributos_check') then
    alter table public.productos add constraint productos_atributos_check check (public.producto_atributos_validos(atributos));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'unidades_atributos_check') then
    alter table public.unidades_serializadas add constraint unidades_atributos_check check (public.unidad_atributos_validos(atributos));
  end if;
end $$;

-- Normaliza y valida el serial al crear la unidad (también dentro de registrar_compra).
create or replace function public.unidades_validar_serial() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tipo text; v_neg integer;
begin
  select tipo_serial, negocio_id into v_tipo, v_neg from public.productos where id = new.producto_id;
  if tg_op = 'INSERT' or new.serial is distinct from old.serial then
    new.serial := trim(new.serial);
    if v_tipo = 'imei' then
      new.serial := regexp_replace(new.serial, '[[:space:].-]', '', 'g');
      if not public.imei_valido(new.serial) then
        raise exception using errcode = '22023', message = 'El IMEI ' || new.serial || ' no es válido (15 dígitos con dígito verificador)';
      end if;
    elsif new.serial = '' or length(new.serial) > 60 then
      raise exception using errcode = '22023', message = 'Serial vacío o demasiado largo';
    end if;
  end if;
  if new.atributos ? 'imei2' then
    new.atributos := jsonb_set(new.atributos, '{imei2}', to_jsonb(regexp_replace(new.atributos->>'imei2', '[[:space:].-]', '', 'g')));
    if new.atributos->>'imei2' = new.serial then raise exception 'El IMEI 2 no puede ser igual al IMEI principal'; end if;
    if exists (select 1 from public.unidades_serializadas u where u.negocio_id = coalesce(new.negocio_id, v_neg) and u.id is distinct from new.id
                and (u.serial = new.atributos->>'imei2' or u.atributos->>'imei2' = new.atributos->>'imei2')) then
      raise exception using errcode = '23505', message = 'El IMEI 2 ya está registrado en otra unidad';
    end if;
  end if;
  if exists (select 1 from public.unidades_serializadas u where u.negocio_id = coalesce(new.negocio_id, v_neg) and u.id is distinct from new.id and u.atributos->>'imei2' = new.serial) then
    raise exception using errcode = '23505', message = 'Ese IMEI ya está registrado como IMEI 2 de otra unidad';
  end if;
  return new;
end $$;
drop trigger if exists unidades_validar_serial on public.unidades_serializadas;
create trigger unidades_validar_serial before insert or update of serial, atributos on public.unidades_serializadas
  for each row execute function public.unidades_validar_serial();
create index if not exists idx_unidades_imei2 on public.unidades_serializadas (negocio_id, (atributos->>'imei2')) where atributos ? 'imei2';

-- Activar o quitar el control por unidad solo sin stock ni unidades: evita stock sin IMEI.
create or replace function public.productos_serial_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.maneja_serial is distinct from old.maneja_serial
     and (old.stock > 0 or exists (select 1 from public.unidades_serializadas where producto_id = old.id)) then
    raise exception 'No se puede cambiar el control por IMEI/serial de un producto con unidades registradas';
  end if;
  if not new.maneja_serial then new.tipo_serial := null; end if;
  return new;
end $$;
revoke all on function public.productos_serial_guard() from public, anon, authenticated;
drop trigger if exists productos_serial_guard on public.productos;
create trigger productos_serial_guard before update of maneja_serial, tipo_serial on public.productos
  for each row execute function public.productos_serial_guard();

-- Editar color/capacidad/IMEI 2/nota de una unidad. No cambia serial, estado ni ventas.
create or replace function public.unidad_actualizar_atributos(p_unidad_id bigint, p_atributos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.unidades_serializadas%rowtype;
begin
  if public.mi_negocio() is null or not public.tiene_permiso('editar_inventario') then
    raise exception using errcode = '42501', message = 'No tienes permiso para modificar el inventario';
  end if;
  select * into u from public.unidades_serializadas where id = p_unidad_id and negocio_id = public.mi_negocio() for update;
  if not found then raise exception 'La unidad no existe'; end if;
  if jsonb_typeof(p_atributos) = 'object' and jsonb_typeof(p_atributos->'imei2') = 'string' then
    p_atributos := jsonb_set(p_atributos, '{imei2}', to_jsonb(regexp_replace(p_atributos->>'imei2', '[[:space:].-]', '', 'g')));
  end if;
  if p_atributos is null or not public.unidad_atributos_validos(p_atributos) then raise exception 'Datos de la unidad no válidos'; end if;
  update public.unidades_serializadas set atributos = p_atributos where id = u.id returning * into u;
  perform public.registrar_actividad('inventario.unidad_detalle', 'unidades_serializadas', u.id::text, jsonb_build_object('serial', u.serial, 'atributos', u.atributos));
  return to_jsonb(u);
end $$;

revoke all on function public.unidades_validar_serial() from public, anon, authenticated;
revoke all on function public.unidad_actualizar_atributos(bigint, jsonb) from public, anon;
grant execute on function public.unidad_actualizar_atributos(bigint, jsonb) to authenticated;
grant execute on function public.imei_valido(text), public.producto_atributos_validos(jsonb), public.unidad_atributos_validos(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
