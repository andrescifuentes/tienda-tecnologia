-- =====================================================================
--  Angie Tech · 13 · Precio especial en la venta (descuentos)
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 10, 11 y 12.
--  Se puede ejecutar más de una vez. No borra datos.
--
--  Administrador y vendedor pueden cambiar el precio de venta de un
--  producto al momento de vender (descuento al cliente) y aplicar un
--  descuento al total. El precio del producto en el inventario NO cambia.
--  Sin límite de descuento: lo decide quien vende. Todo descuento queda
--  registrado en la factura (con quién vendió) y en el historial.
-- =====================================================================
begin;

-- Emitir factura: cualquier perfil que venda puede dar precio especial o descuento
create or replace function emitir_factura(
  p_cliente_id  bigint,
  p_metodo_pago metodo_pago,
  p_items       jsonb,
  p_descuento   numeric default 0,
  p_notas       text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_neg        integer := mi_negocio();
  v_prefijo    text;
  v_numero     integer;
  v_factura    bigint;
  it           jsonb;
  v_prod       productos%rowtype;
  v_unidad     unidades_serializadas%rowtype;
  v_cant       integer;
  v_desc       numeric;
  v_item       bigint;
  v_subtotal   numeric := 0;
  v_desc_items numeric := 0;
  v_costo      numeric := 0;
  v_desc_total numeric;
  v_total      numeric;
begin
  if v_neg is null or not tiene_permiso('vender') then
    raise exception 'No tienes permiso para vender';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La factura necesita al menos un producto';
  end if;
  if coalesce(p_descuento, 0) < 0 then
    raise exception 'El descuento no puede ser negativo';
  end if;
  if p_cliente_id is not null and not exists (select 1 from clientes where id = p_cliente_id and negocio_id = v_neg) then
    raise exception 'El cliente no existe';
  end if;

  update tienda set ultimo_numero_factura = ultimo_numero_factura + 1
   where id = v_neg
   returning factura_prefijo, ultimo_numero_factura into v_prefijo, v_numero;
  if not found then raise exception 'El negocio no existe'; end if;

  insert into facturas (negocio_id, prefijo, numero, cliente_id, vendedor_id, metodo_pago, notas)
  values (v_neg, v_prefijo, v_numero, p_cliente_id, v_uid, p_metodo_pago, p_notas)
  returning id into v_factura;

  for it in select e from jsonb_array_elements(p_items) e loop
    v_cant := coalesce((it->>'cantidad')::integer, 1);
    v_desc := coalesce((it->>'descuento')::numeric, 0);
    if v_cant <= 0 then
      raise exception 'La cantidad debe ser mayor que cero';
    end if;
    if v_desc < 0 then
      raise exception 'Descuento no permitido en el producto %', it->>'producto_id';
    end if;

    select * into v_prod from productos
     where id = (it->>'producto_id')::bigint and negocio_id = v_neg and activo for update;
    if not found then
      raise exception 'El producto % no está disponible', it->>'producto_id';
    end if;

    v_unidad := null;
    if v_prod.maneja_serial then
      if v_cant <> 1 or (it->>'unidad_id') is null then
        raise exception 'El producto "%" requiere una línea por equipo, con su unidad_id y cantidad 1', v_prod.nombre;
      end if;
      select * into v_unidad from unidades_serializadas
       where id = (it->>'unidad_id')::bigint and producto_id = v_prod.id and estado = 'disponible'
       for update;
      if not found then
        raise exception 'La unidad indicada para "%" no está disponible', v_prod.nombre;
      end if;
    end if;

    if v_desc > 0 and v_desc >= v_cant * v_prod.precio_venta then
      raise exception 'El precio de "%" no puede quedar en cero o negativo', v_prod.nombre;
    end if;

    insert into factura_items (factura_id, producto_id, unidad_id, nombre, cantidad,
                               precio_unitario, descuento, costo_unitario)
    values (v_factura, v_prod.id, v_unidad.id, v_prod.nombre, v_cant,
            v_prod.precio_venta, v_desc, v_prod.precio_compra)
    returning id into v_item;

    if v_unidad.id is not null then
      update unidades_serializadas set estado = 'vendida', factura_item_id = v_item
       where id = v_unidad.id;
    end if;

    insert into movimientos_inventario (negocio_id, producto_id, tipo, cantidad, costo_unitario,
                                        referencia_tipo, referencia_id, creado_por)
    values (v_neg, v_prod.id, 'salida_venta', -v_cant, v_prod.precio_compra, 'factura', v_factura, v_uid);

    if v_prod.garantia_meses > 0 then
      insert into garantias (negocio_id, factura_item_id, producto_id, cliente_id, unidad_id, inicio, fin)
      values (v_neg, v_item, v_prod.id, p_cliente_id, v_unidad.id, hoy_tienda(),
              (hoy_tienda() + make_interval(months => v_prod.garantia_meses))::date);
    end if;

    v_subtotal   := v_subtotal   + v_cant * v_prod.precio_venta;
    v_desc_items := v_desc_items + v_desc;
    v_costo      := v_costo      + v_cant * v_prod.precio_compra;
  end loop;

  v_desc_total := v_desc_items + coalesce(p_descuento, 0);
  if v_desc_total > v_subtotal then
    raise exception 'El descuento no puede superar el subtotal';
  end if;
  v_total := v_subtotal - v_desc_total;

  -- Sin comisiones para vendedores (script 08)
  update facturas
     set subtotal = v_subtotal, descuento = v_desc_total, total = v_total,
         costo_total = v_costo, comision_pct = null, comision = null
   where id = v_factura;

  perform registrar_actividad('factura.emitida', 'facturas', v_factura::text,
          jsonb_build_object('numero', v_prefijo || v_numero, 'total', v_total, 'descuento', v_desc_total));
  return v_factura;
end $$;

revoke all on function emitir_factura(bigint, metodo_pago, jsonb, numeric, text) from public, anon;
grant execute on function emitir_factura(bigint, metodo_pago, jsonb, numeric, text) to authenticated;
notify pgrst, 'reload schema';
commit;

-- Verificación: debe devolver 1 fila
select proname from pg_proc where proname = 'emitir_factura';
