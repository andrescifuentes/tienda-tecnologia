-- PREPARADO LOCALMENTE. NO EJECUTADO. Revisar en staging antes de aplicar.
-- Conserva facturas existentes; no modifica Auth ni elimina datos.
begin;
alter table public.facturas add column if not exists request_id text;
do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='facturas' and column_name='request_id' and data_type<>'text') then
    raise exception 'Revisar el tipo de request_id antes de aplicar esta migración';
  end if;
end $$;
create unique index if not exists facturas_vendedor_request_unique on public.facturas(vendedor_id, request_id) where request_id is not null;
create or replace function public.emitir_factura_segura(
  p_actor_id uuid, p_request_id text, p_cliente_id bigint,
  p_metodo_pago public.metodo_pago, p_items jsonb,
  p_descuento numeric default 0, p_notas text default null
) returns bigint language plpgsql security definer set search_path=public as $$
declare v_id bigint;
begin
  if auth.uid() is distinct from p_actor_id or not public.tiene_permiso('vender') then
    raise exception 'La sesión no tiene permiso para emitir esta venta';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9-]{8,100}$' then
    raise exception 'Identificador de venta no válido';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || ':' || p_request_id, 0));
  select id into v_id from public.facturas where vendedor_id=p_actor_id and request_id=p_request_id;
  if found then return v_id; end if;
  v_id := public.emitir_factura(p_cliente_id,p_metodo_pago,p_items,p_descuento,p_notas);
  update public.facturas set request_id=p_request_id where id=v_id and vendedor_id=p_actor_id;
  return v_id;
end $$;
revoke all on function public.emitir_factura_segura(uuid,text,bigint,public.metodo_pago,jsonb,numeric,text) from public,anon;
grant execute on function public.emitir_factura_segura(uuid,text,bigint,public.metodo_pago,jsonb,numeric,text) to authenticated;
notify pgrst, 'reload schema';
commit;
