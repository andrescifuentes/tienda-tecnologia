-- =====================================================================
--  Angie Tech · 14 · Venta rápida sin datos del cliente
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 10 a 13.
--  Se puede ejecutar más de una vez. No borra datos.
--
--  Cada negocio tiene un cliente "Consumidor final" (documento 000000).
--  Cuando el cliente no da sus datos, la venta se registra a ese cliente:
--  queda la factura, quién vendió, la fecha y los productos, sin mezclar
--  esas compras con los datos del administrador.
-- =====================================================================
-- Si ya se había creado con el documento anterior, se cambia a 000000
update clientes c set documento = '000000'
 where c.documento = '222222222222' and c.nombre = 'Consumidor final'
   and not exists (select 1 from clientes x where x.negocio_id = c.negocio_id and x.tipo_documento = c.tipo_documento and x.documento = '000000');

create or replace function cliente_consumidor_final() returns bigint
language plpgsql security definer set search_path = public as $$
declare v_neg integer := mi_negocio(); v_id bigint;
begin
  if v_neg is null or not tiene_permiso('vender') then
    raise exception 'No tienes permiso para vender';
  end if;
  select id into v_id from clientes
   where negocio_id = v_neg and tipo_documento = 'CC' and documento = '000000';
  if v_id is null then
    insert into clientes (negocio_id, tipo_documento, documento, nombre, creado_por)
    values (v_neg, 'CC', '000000', 'Consumidor final', auth.uid())
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from clientes
       where negocio_id = v_neg and tipo_documento = 'CC' and documento = '000000';
    end if;
  end if;
  return v_id;
end $$;

revoke all on function cliente_consumidor_final() from public, anon;
grant execute on function cliente_consumidor_final() to authenticated;
notify pgrst, 'reload schema';

-- Verificación: debe devolver 1 fila
select proname from pg_proc where proname = 'cliente_consumidor_final';
