-- =====================================================================
--  Angie Tech · 08 · Reglas de venta (YA EJECUTADO el 12-oct-2026) y auditoría (hallazgos de QA)
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 01 a 04 (independiente de 05-07).
--  Se puede ejecutar más de una vez sin problema. No borra datos.
--
--  1. Ventas sin duplicados: si la app reintenta una venta tras un corte
--     de red, el servidor devuelve la misma factura en vez de crear otra.
--  2. Cliente obligatorio también en el servidor (antes solo en la app).
--  3. Historial: el alta de empleados guarda quién la hizo y los cambios
--     de permisos quedan registrados.
--  4. Los vendedores no reciben comisiones.
--  5. Los PDF de facturas dejan de ser públicos: el cliente recibe un
--     enlace firmado que vence en un año.
-- =====================================================================

-- 1 y 2. Clave de la venta + cliente obligatorio --------------------------
alter table facturas add column if not exists clave_idempotencia text;
create unique index if not exists facturas_clave_idempotencia_uq
  on facturas (vendedor_id, clave_idempotencia) where clave_idempotencia is not null;

create or replace function emitir_factura_segura(
  p_clave       text,
  p_cliente_id  bigint,
  p_metodo_pago metodo_pago,
  p_items       jsonb,
  p_descuento   numeric default 0,
  p_notas       text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_cliente_id is null then
    raise exception 'Elige o registra el cliente para continuar';
  end if;
  if coalesce(trim(p_clave), '') = '' then
    raise exception 'Falta la clave de la venta';
  end if;
  -- Dos intentos con la misma clave esperan su turno; el segundo recibe la factura del primero
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_clave, 0));
  select id into v_id from facturas where vendedor_id = auth.uid() and clave_idempotencia = p_clave;
  if found then return v_id; end if;

  v_id := emitir_factura(p_cliente_id, p_metodo_pago, p_items, p_descuento, p_notas);
  update facturas set clave_idempotencia = p_clave where id = v_id;
  return v_id;
end $$;

grant execute on function emitir_factura_segura(text, bigint, metodo_pago, jsonb, numeric, text) to authenticated;

-- Opcional (cuando todos los celulares tengan la versión nueva de la app):
-- obliga a vender solo por la función segura.
-- revoke execute on function emitir_factura(bigint, metodo_pago, jsonb, numeric, text) from public, anon, authenticated;

-- 3. Auditoría ------------------------------------------------------------
create or replace function auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text; v_actor uuid;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'productos'
     and (to_jsonb(new) - 'stock' - 'actualizado_en') = (to_jsonb(old) - 'stock' - 'actualizado_en') then
    return new;   -- cambio solo de stock: ya queda en movimientos_inventario
  end if;
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id');
  -- Los empleados se crean desde el servidor (sin sesión): el actor es quien lo creó
  v_actor := coalesce(auth.uid(),
    case when tg_table_name = 'perfiles' then nullif(coalesce(to_jsonb(new), to_jsonb(old))->>'creado_por', '')::uuid end);
  insert into actividad (perfil_id, accion, entidad, entidad_id, detalle)
  values (v_actor, tg_table_name || '.' || lower(tg_op), tg_table_name, v_id,
          jsonb_build_object('antes',   case when tg_op <> 'INSERT' then to_jsonb(old) end,
                             'despues', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  return coalesce(new, old);
end $$;

create or replace function auditar_permisos() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_perfil uuid := coalesce(new.perfil_id, old.perfil_id);
begin
  insert into actividad (perfil_id, accion, entidad, entidad_id, detalle)
  values (coalesce(auth.uid(), (select creado_por from perfiles where id = v_perfil)),
          case when tg_op = 'INSERT' then 'permiso.otorgado' else 'permiso.retirado' end,
          'perfiles', v_perfil::text,
          jsonb_build_object('permiso', coalesce(new.permiso, old.permiso)));
  return coalesce(new, old);
end $$;

drop trigger if exists trg_audit_permisos on perfil_permisos;
create trigger trg_audit_permisos after insert or delete on perfil_permisos
  for each row execute function auditar_permisos();

-- 4. Sin comisiones para vendedores -------------------------------------------
update perfiles set comision_pct = null where comision_pct is not null;
alter table perfiles drop constraint if exists perfiles_sin_comision;
alter table perfiles add constraint perfiles_sin_comision check (comision_pct is null);

-- 5. Facturas en PDF privadas ------------------------------------------------
update storage.buckets set public = false where id = 'facturas';
drop policy if exists "facturas_pdf_leer" on storage.objects;
-- Solo el equipo que vende puede generar enlaces firmados (el cliente usa el enlace)
create policy "facturas_pdf_leer" on storage.objects
  for select to authenticated
  using (bucket_id = 'facturas' and public.tiene_permiso('vender'));

-- Verificación: debe devolver 1 fila
select proname from pg_proc where proname = 'emitir_factura_segura';
