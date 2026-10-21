-- =====================================================================
--  Angie Tech · 16 · Varios locales (sedes) en el mismo negocio
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 10 al 15.
--  ANTES: saca un respaldo (Database > Backups).
--  Se puede ejecutar más de una vez. Si algo falla, no se aplica nada.
--
--  Qué hace:
--  1. Crea la tabla "locales". Cada negocio queda con un "Local 1" que
--     toma la dirección, el número de local y el teléfono del negocio.
--     El administrador crea el segundo local en Más › Configuración.
--  2. Lo compartido sigue igual: catálogo, precios, proveedores, clientes
--     y la numeración de facturas (FV-…).
--  3. El stock pasa a ser POR LOCAL (tabla stock_local). productos.stock
--     sigue siendo el total de todos los locales. Todo el inventario
--     actual queda en el Local 1 (no se pierde nada).
--  4. Cada venta queda en el local donde se hizo. Cada producto vendido
--     indica de qué local salió: un vendedor puede vender un producto que
--     solo hay en el otro local y se descuenta del inventario de ese local.
--  5. Compras, ajustes e ingresos/gastos indican el local. Hay una función
--     para trasladar mercancía entre locales.
--  6. Los vendedores se asignan a un local (solo el administrador lo
--     cambia). El administrador ve todos los locales o uno a la vez.
--  7. La factura muestra la dirección y el teléfono del local que vendió.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Locales
-- ---------------------------------------------------------------------
create table if not exists locales (
  id          bigint generated always as identity primary key,
  negocio_id  integer not null references tienda(id) default mi_negocio(),
  nombre      text not null check (length(trim(nombre)) between 1 and 60),
  direccion   text check (direccion is null or length(direccion) <= 160),
  numero      text check (numero is null or length(numero) <= 30),
  telefono    text check (telefono is null or length(telefono) <= 40),
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);
create unique index if not exists locales_negocio_nombre_uq on locales (negocio_id, lower(trim(nombre)));
create index if not exists idx_locales_negocio on locales (negocio_id);
alter table perfiles add column if not exists local_id bigint references locales(id);

-- Local principal: el primero activo del negocio
create or replace function local_principal(p_negocio integer) returns bigint
language sql stable security definer set search_path = public as $$
  select id from locales where negocio_id = p_negocio and activo order by id limit 1
$$;
-- Local asignado a quien inició sesión (null = todos, para administradores sin local)
create or replace function mi_local() returns bigint
language sql stable security definer set search_path = public as $$
  select local_id from perfiles where id = auth.uid() and activo
$$;
-- ¿El local existe, está activo y es de mi negocio?
create or replace function local_de_mi_negocio(p_local bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from locales where id = p_local and activo and negocio_id = mi_negocio())
$$;
create or replace function nombre_local(p_local bigint) returns text
language sql stable security definer set search_path = public as $$
  select nombre from locales where id = p_local
$$;

-- Cada negocio nuevo nace con su local principal
create or replace function tienda_crear_local() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from locales where negocio_id = new.id) then
    insert into locales (negocio_id, nombre) values (new.id, 'Local 1');
  end if;
  return new;
end $$;
drop trigger if exists trg_tienda_crear_local on tienda;
create trigger trg_tienda_crear_local after insert on tienda
  for each row execute function tienda_crear_local();

insert into locales (negocio_id, nombre, direccion, numero, telefono)
select t.id, 'Local 1', t.direccion, t.local, t.telefono
  from tienda t
 where not exists (select 1 from locales l where l.negocio_id = t.id);

-- No se desactiva un local con inventario o con vendedores asignados
create or replace function locales_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.negocio_id is distinct from old.negocio_id then
    raise exception 'No se puede cambiar el negocio de un local';
  end if;
  if old.activo and not new.activo then
    if exists (select 1 from stock_local where local_id = old.id and stock > 0) then
      raise exception 'El local "%" todavía tiene inventario. Trasládalo antes de desactivarlo', old.nombre;
    end if;
    if exists (select 1 from perfiles where local_id = old.id and activo) then
      raise exception 'El local "%" tiene empleados asignados. Cámbialos de local antes de desactivarlo', old.nombre;
    end if;
    if not exists (select 1 from locales where negocio_id = old.negocio_id and activo and id <> old.id) then
      raise exception 'El negocio necesita al menos un local activo';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Stock por local
-- ---------------------------------------------------------------------
create table if not exists stock_local (
  negocio_id  integer not null references tienda(id),
  producto_id bigint  not null references productos(id),
  local_id    bigint  not null references locales(id),
  stock       integer not null default 0 check (stock >= 0),
  primary key (producto_id, local_id)
);
create index if not exists idx_stock_local_negocio on stock_local (negocio_id);
create index if not exists idx_stock_local_local on stock_local (local_id);

drop trigger if exists trg_locales_guard on locales;
create trigger trg_locales_guard before update on locales
  for each row execute function locales_guard();

-- ---------------------------------------------------------------------
-- 3. Columnas de local
-- ---------------------------------------------------------------------
alter table movimientos_inventario add column if not exists local_id bigint references locales(id);
alter table movimientos_inventario add column if not exists stock_local_despues integer;
alter table unidades_serializadas  add column if not exists local_id bigint references locales(id);
alter table facturas               add column if not exists local_id bigint references locales(id);
alter table factura_items          add column if not exists local_id bigint references locales(id);
alter table compras                add column if not exists local_id bigint references locales(id);
alter table movimientos            add column if not exists local_id bigint references locales(id);  -- null = general (ambos locales)
create index if not exists idx_facturas_local  on facturas (local_id);
create index if not exists idx_unidades_local  on unidades_serializadas (local_id);
create index if not exists idx_movinv_local    on movimientos_inventario (local_id);
create index if not exists idx_compras_local   on compras (local_id);
create index if not exists idx_movimientos_local on movimientos (local_id);
create index if not exists idx_perfiles_local  on perfiles (local_id);

-- Lo que ya existe queda en el Local 1 de cada negocio (sin disparar auditoría ni bloqueos)
do $$
declare t text;
begin
  foreach t in array array['unidades_serializadas','facturas','compras','movimientos','movimientos_inventario'] loop
    execute format('alter table %I disable trigger user', t);
    execute format('update %I x set local_id = local_principal(x.negocio_id) where x.local_id is null', t);
    execute format('alter table %I enable trigger user', t);
  end loop;
  alter table factura_items disable trigger user;
  update factura_items i set local_id = f.local_id from facturas f where f.id = i.factura_id and i.local_id is null;
  alter table factura_items enable trigger user;
end $$;

-- Vendedores existentes: al Local 1 (los administradores quedan sin local = ven todos)
alter table perfiles disable trigger user;
update perfiles p set local_id = local_principal(p.negocio_id) where p.local_id is null and p.rol <> 'admin';
alter table perfiles enable trigger user;

insert into stock_local (negocio_id, producto_id, local_id, stock)
select p.negocio_id, p.id, local_principal(p.negocio_id), p.stock
  from productos p
 where p.stock > 0 and not exists (select 1 from stock_local s where s.producto_id = p.id)
on conflict do nothing;

-- El local de un empleado es del mismo negocio y solo lo cambia el administrador
create or replace function perfiles_local_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.local_id is not null and not exists (select 1 from locales where id = new.local_id and negocio_id = new.negocio_id and activo) then
    raise exception 'El local elegido no es válido';
  end if;
  if tg_op = 'UPDATE' and new.local_id is distinct from old.local_id
     and current_user in ('authenticated', 'anon') and not es_admin() then
    raise exception 'Solo el administrador puede cambiar el local de un empleado';
  end if;
  if tg_op = 'INSERT' and new.local_id is null and new.rol <> 'admin' then
    new.local_id := coalesce((select local_id from perfiles where id = new.creado_por), local_principal(new.negocio_id));
  end if;
  return new;
end $$;
drop trigger if exists trg_perfiles_local on perfiles;
-- "zz" para que corra después de trg_perfiles_negocio (que fija el negocio)
drop trigger if exists zz_perfiles_local on perfiles;
create trigger zz_perfiles_local before insert or update of local_id, rol on perfiles
  for each row execute function perfiles_local_guard();

-- Las unidades (IMEI/serial) solo cambian de local con un traslado
create or replace function unidades_local_guard() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.local_id := coalesce(new.local_id, mi_local(), local_principal(new.negocio_id));
    elsif new.local_id is distinct from old.local_id then
      raise exception 'Para cambiar un equipo de local usa «Trasladar»';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_unidades_local on unidades_serializadas;
create trigger trg_unidades_local before insert or update of local_id on unidades_serializadas
  for each row execute function unidades_local_guard();

-- Ingresos y gastos: local válido del negocio (o general)
create or replace function movimientos_local_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.local_id is not null and not exists (select 1 from locales where id = new.local_id and negocio_id = new.negocio_id) then
    raise exception 'El local elegido no es válido';
  end if;
  return new;
end $$;
drop trigger if exists trg_movimientos_local on movimientos;
create trigger trg_movimientos_local before insert or update of local_id on movimientos
  for each row execute function movimientos_local_guard();

-- ---------------------------------------------------------------------
-- 4. Cada movimiento de inventario descuenta o suma en SU local
-- ---------------------------------------------------------------------
create or replace function aplicar_movimiento_inventario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_stock integer;
  v_neg   integer;
  v_local bigint;
  v_sl    integer;
begin
  select stock, negocio_id into v_stock, v_neg from productos where id = new.producto_id for update;
  if not found then
    raise exception 'El producto % no existe', new.producto_id;
  end if;
  v_local := coalesce(new.local_id,
                      (select local_id from perfiles where id = new.creado_por),
                      local_principal(v_neg));
  if v_local is null or not exists (select 1 from locales where id = v_local and negocio_id = v_neg) then
    raise exception 'El local del movimiento no es válido';
  end if;
  new.local_id := v_local;

  insert into stock_local (negocio_id, producto_id, local_id, stock)
  values (v_neg, new.producto_id, v_local, 0)
  on conflict (producto_id, local_id) do nothing;
  select stock into v_sl from stock_local
   where producto_id = new.producto_id and local_id = v_local for update;

  if v_sl + new.cantidad < 0 then
    raise exception 'Stock insuficiente de "%" en %: hay %, se necesitan %',
      (select nombre from productos where id = new.producto_id), nombre_local(v_local), v_sl, -new.cantidad;
  end if;
  update stock_local set stock = v_sl + new.cantidad
   where producto_id = new.producto_id and local_id = v_local;

  new.stock_local_despues := v_sl + new.cantidad;
  new.stock_despues := v_stock + new.cantidad;   -- total de todos los locales
  update productos set stock = new.stock_despues where id = new.producto_id;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. Vender (con stock de cualquier local)
--    p_items: [{"producto_id":1,"cantidad":2,"descuento":0,"local_id":2}, …]
--    local_id del ítem = de dónde sale el producto (si falta, del local de la venta).
--    En equipos con serial, sale del local donde está la unidad.
-- ---------------------------------------------------------------------
drop function if exists emitir_factura_segura(text, bigint, metodo_pago, jsonb, numeric, text);
drop function if exists emitir_factura(bigint, metodo_pago, jsonb, numeric, text);

create or replace function emitir_factura(
  p_cliente_id  bigint,
  p_metodo_pago metodo_pago,
  p_items       jsonb,
  p_descuento   numeric default 0,
  p_notas       text default null,
  p_local_id    bigint default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_neg        integer := mi_negocio();
  v_mi_local   bigint := mi_local();
  v_local      bigint;
  v_origen     bigint;
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
  v_otros      jsonb := '[]'::jsonb;
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

  -- Local de la venta: el vendedor vende en SU local; el administrador elige
  if v_mi_local is not null and not es_admin() then
    v_local := v_mi_local;
  else
    v_local := coalesce(p_local_id, v_mi_local, local_principal(v_neg));
  end if;
  if not local_de_mi_negocio(v_local) then
    raise exception 'El local de la venta no es válido';
  end if;

  update tienda set ultimo_numero_factura = ultimo_numero_factura + 1
   where id = v_neg
   returning factura_prefijo, ultimo_numero_factura into v_prefijo, v_numero;
  if not found then raise exception 'El negocio no existe'; end if;

  insert into facturas (negocio_id, local_id, prefijo, numero, cliente_id, vendedor_id, metodo_pago, notas)
  values (v_neg, v_local, v_prefijo, v_numero, p_cliente_id, v_uid, p_metodo_pago, p_notas)
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

    v_origen := coalesce(nullif(it->>'local_id', '')::bigint, v_local);
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
      v_origen := coalesce(v_unidad.local_id, v_origen);
    end if;
    if not local_de_mi_negocio(v_origen) then
      raise exception 'El local de origen de "%" no es válido', v_prod.nombre;
    end if;

    if v_desc > 0 and v_desc >= v_cant * v_prod.precio_venta then
      raise exception 'El precio de "%" no puede quedar en cero o negativo', v_prod.nombre;
    end if;

    insert into factura_items (factura_id, producto_id, unidad_id, nombre, cantidad,
                               precio_unitario, descuento, costo_unitario, local_id)
    values (v_factura, v_prod.id, v_unidad.id, v_prod.nombre, v_cant,
            v_prod.precio_venta, v_desc, v_prod.precio_compra, v_origen)
    returning id into v_item;

    if v_unidad.id is not null then
      update unidades_serializadas set estado = 'vendida', factura_item_id = v_item
       where id = v_unidad.id;
    end if;

    insert into movimientos_inventario (negocio_id, producto_id, local_id, tipo, cantidad, costo_unitario,
                                        referencia_tipo, referencia_id, creado_por)
    values (v_neg, v_prod.id, v_origen, 'salida_venta', -v_cant, v_prod.precio_compra, 'factura', v_factura, v_uid);

    if v_origen <> v_local then
      v_otros := v_otros || jsonb_build_object('producto', v_prod.nombre, 'cantidad', v_cant,
                                               'local_id', v_origen, 'local', nombre_local(v_origen));
    end if;

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

  update facturas
     set subtotal = v_subtotal, descuento = v_desc_total, total = v_total,
         costo_total = v_costo, comision_pct = null, comision = null
   where id = v_factura;

  perform registrar_actividad('factura.emitida', 'facturas', v_factura::text,
          jsonb_build_object('numero', v_prefijo || v_numero, 'total', v_total, 'descuento', v_desc_total,
                             'local_id', v_local, 'local', nombre_local(v_local)));
  if jsonb_array_length(v_otros) > 0 then
    perform registrar_actividad('factura.otro_local', 'facturas', v_factura::text,
            jsonb_build_object('numero', v_prefijo || v_numero, 'local_id', v_local, 'local', nombre_local(v_local),
                               'items', v_otros));
  end if;
  return v_factura;
end $$;

create or replace function emitir_factura_segura(
  p_clave       text,
  p_cliente_id  bigint,
  p_metodo_pago metodo_pago,
  p_items       jsonb,
  p_descuento   numeric default 0,
  p_notas       text default null,
  p_local_id    bigint default null
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
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_clave, 0));
  select id into v_id from facturas
   where vendedor_id = auth.uid() and clave_idempotencia = p_clave and negocio_id = mi_negocio();
  if found then return v_id; end if;

  v_id := emitir_factura(p_cliente_id, p_metodo_pago, p_items, p_descuento, p_notas, p_local_id);
  update facturas set clave_idempotencia = p_clave where id = v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Anular y devolver: el stock vuelve al local de donde salió
-- ---------------------------------------------------------------------
create or replace function anular_factura(p_factura_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  f  facturas%rowtype;
  it record;
begin
  if not tiene_permiso('anular_facturas') then
    raise exception 'No tienes permiso para anular facturas';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'El motivo de anulación es obligatorio';
  end if;
  select * into f from facturas where id = p_factura_id and negocio_id = mi_negocio() for update;
  if not found then raise exception 'La factura no existe'; end if;
  if f.estado = 'anulada' then raise exception 'La factura ya está anulada'; end if;
  if exists (select 1 from devoluciones where factura_id = f.id) then
    raise exception 'La factura tiene devoluciones y no se puede anular';
  end if;

  update facturas
     set estado = 'anulada', anulada_por = auth.uid(), anulada_en = now(), motivo_anulacion = p_motivo
   where id = f.id;

  for it in select * from factura_items where factura_id = f.id loop
    insert into movimientos_inventario (negocio_id, producto_id, local_id, tipo, cantidad, costo_unitario, motivo,
                                        referencia_tipo, referencia_id, creado_por)
    values (f.negocio_id, it.producto_id, coalesce(it.local_id, f.local_id), 'devolucion_cliente', it.cantidad, it.costo_unitario,
            'Anulación de factura ' || f.prefijo || f.numero, 'factura', f.id, auth.uid());
  end loop;

  update unidades_serializadas set estado = 'disponible', factura_item_id = null
   where factura_item_id in (select id from factura_items where factura_id = f.id);
  update garantias set estado = 'vencida', fin = least(fin, hoy_tienda())
   where factura_item_id in (select id from factura_items where factura_id = f.id);

  perform registrar_actividad('factura.anulada', 'facturas', f.id::text,
          jsonb_build_object('numero', f.prefijo || f.numero, 'motivo', p_motivo));
end $$;

create or replace function registrar_devolucion(
  p_factura_id      bigint,
  p_items           jsonb,
  p_motivo          text,
  p_reintegra_stock boolean default true
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  f        facturas%rowtype;
  fi       factura_items%rowtype;
  it       jsonb;
  v_dev    bigint;
  v_cant   integer;
  v_ya     integer;
  v_monto  numeric;
  v_total  numeric := 0;
begin
  if not tiene_permiso('hacer_devoluciones') then
    raise exception 'No tienes permiso para hacer devoluciones';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'El motivo de la devolución es obligatorio';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Indica qué productos se devuelven';
  end if;
  select * into f from facturas where id = p_factura_id and negocio_id = mi_negocio() for update;
  if not found then raise exception 'La factura no existe'; end if;
  if f.estado <> 'emitida' then raise exception 'La factura está anulada'; end if;

  insert into devoluciones (factura_id, motivo, reintegra_stock, creado_por)
  values (f.id, p_motivo, p_reintegra_stock, auth.uid())
  returning id into v_dev;

  for it in select e from jsonb_array_elements(p_items) e loop
    select * into fi from factura_items
     where id = (it->>'factura_item_id')::bigint and factura_id = f.id;
    if not found then raise exception 'El ítem % no pertenece a la factura', it->>'factura_item_id'; end if;

    v_cant := (it->>'cantidad')::integer;
    select coalesce(sum(cantidad), 0) into v_ya from devolucion_items where factura_item_id = fi.id;
    if v_cant is null or v_cant <= 0 or v_cant + v_ya > fi.cantidad then
      raise exception 'Cantidad a devolver inválida para "%"', fi.nombre;
    end if;

    v_monto := round((fi.precio_unitario * fi.cantidad - fi.descuento) * v_cant / fi.cantidad);
    insert into devolucion_items (devolucion_id, factura_item_id, cantidad, monto)
    values (v_dev, fi.id, v_cant, v_monto);
    v_total := v_total + v_monto;

    if p_reintegra_stock then
      insert into movimientos_inventario (negocio_id, producto_id, local_id, tipo, cantidad, costo_unitario, motivo,
                                          referencia_tipo, referencia_id, creado_por)
      values (f.negocio_id, fi.producto_id, coalesce(fi.local_id, f.local_id), 'devolucion_cliente', v_cant, fi.costo_unitario,
              'Devolución de factura ' || f.prefijo || f.numero, 'devolucion', v_dev, auth.uid());
      update unidades_serializadas set estado = 'disponible', factura_item_id = null
       where factura_item_id = fi.id;
    else
      update unidades_serializadas set estado = 'devuelta' where factura_item_id = fi.id;
    end if;

    update garantias set estado = 'vencida', fin = least(fin, hoy_tienda())
     where factura_item_id = fi.id;
  end loop;

  update devoluciones set total_devuelto = v_total, comision_revertida = 0 where id = v_dev;

  perform registrar_actividad('factura.devolucion', 'devoluciones', v_dev::text,
          jsonb_build_object('factura', f.prefijo || f.numero, 'total_devuelto', v_total));
  return v_dev;
end $$;

-- ---------------------------------------------------------------------
-- 7. Compras: la mercancía entra al local que se elija
-- ---------------------------------------------------------------------
drop function if exists registrar_compra(bigint, text, forma_pago_compra, date, jsonb, jsonb, metodo_pago);
create or replace function registrar_compra(
  p_proveedor_id     bigint,
  p_numero_documento text,
  p_forma_pago       forma_pago_compra,
  p_vence_el         date,
  p_items            jsonb,
  p_seriales         jsonb default '[]'::jsonb,
  p_metodo_pago      metodo_pago default 'efectivo',
  p_local_id         bigint default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_neg     integer := mi_negocio();
  v_local   bigint;
  v_compra  bigint;
  it        jsonb;
  s         jsonb;
  v_prod    productos%rowtype;
  v_item    bigint;
  v_cant    integer;
  v_costo   numeric;
  v_total   numeric := 0;
  v_n       integer;
begin
  if v_neg is null or not tiene_permiso('registrar_compras') then
    raise exception 'No tienes permiso para registrar compras';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La compra necesita al menos un producto';
  end if;
  if p_forma_pago = 'credito' and p_vence_el is null then
    raise exception 'Una compra a crédito necesita fecha de vencimiento';
  end if;
  if not exists (select 1 from proveedores where id = p_proveedor_id and negocio_id = v_neg) then
    raise exception 'El proveedor no existe';
  end if;
  v_local := coalesce(p_local_id, mi_local(), local_principal(v_neg));
  if not local_de_mi_negocio(v_local) then
    raise exception 'El local de destino no es válido';
  end if;

  perform set_config('app.bypass_precios', '1', true);

  insert into compras (negocio_id, local_id, proveedor_id, numero_documento, forma_pago, vence_el, registrado_por, fecha)
  values (v_neg, v_local, p_proveedor_id, p_numero_documento, p_forma_pago, p_vence_el, auth.uid(), hoy_tienda())
  returning id into v_compra;

  for it in select e from jsonb_array_elements(p_items) e loop
    v_cant  := (it->>'cantidad')::integer;
    v_costo := (it->>'costo_unitario')::numeric;
    if v_cant is null or v_cant <= 0 or v_costo is null or v_costo < 0 then
      raise exception 'Cantidad o costo inválido en la compra';
    end if;
    select * into v_prod from productos
     where id = (it->>'producto_id')::bigint and negocio_id = v_neg and activo for update;
    if not found then raise exception 'El producto % no está disponible', it->>'producto_id'; end if;

    insert into compra_items (compra_id, producto_id, cantidad, costo_unitario)
    values (v_compra, v_prod.id, v_cant, v_costo)
    returning id into v_item;

    if v_prod.maneja_serial then
      v_n := 0;
      for s in select e from jsonb_array_elements(p_seriales) e
                where (e->>'producto_id')::bigint = v_prod.id loop
        insert into unidades_serializadas (negocio_id, producto_id, serial, compra_item_id, local_id)
        values (v_neg, v_prod.id, trim(s->>'serial'), v_item, v_local);
        v_n := v_n + 1;
      end loop;
      if v_n <> v_cant then
        raise exception 'El producto "%" requiere % seriales y recibió %', v_prod.nombre, v_cant, v_n;
      end if;
    end if;

    insert into movimientos_inventario (negocio_id, producto_id, local_id, tipo, cantidad, costo_unitario,
                                        referencia_tipo, referencia_id, creado_por)
    values (v_neg, v_prod.id, v_local, 'entrada_compra', v_cant, v_costo, 'compra', v_compra, auth.uid());

    update productos set precio_compra = v_costo where id = v_prod.id;  -- último costo
    v_total := v_total + v_cant * v_costo;
  end loop;

  update compras set total = v_total where id = v_compra;
  if p_forma_pago = 'contado' then
    insert into pagos_proveedor (compra_id, monto, metodo_pago, registrado_por)
    values (v_compra, v_total, p_metodo_pago, auth.uid());
  end if;

  perform registrar_actividad('compra.registrada', 'compras', v_compra::text,
          jsonb_build_object('proveedor_id', p_proveedor_id, 'total', v_total, 'local', nombre_local(v_local)));
  return v_compra;
end $$;

-- ---------------------------------------------------------------------
-- 8. Ajustes de inventario en un local
-- ---------------------------------------------------------------------
drop function if exists ajustar_inventario(bigint, integer, tipo_mov_inventario, text);
create or replace function ajustar_inventario(
  p_producto_id bigint,
  p_cantidad    integer,
  p_tipo        tipo_mov_inventario,
  p_motivo      text,
  p_local_id    bigint default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_neg   integer := mi_negocio();
  v_local bigint;
  v_costo numeric;
  v_mov   bigint;
begin
  if not tiene_permiso('editar_inventario') then
    raise exception 'No tienes permiso para modificar el inventario';
  end if;
  if p_tipo not in ('ajuste_entrada', 'ajuste_salida', 'devolucion_proveedor') then
    raise exception 'Tipo de movimiento no permitido en un ajuste manual';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'El motivo es obligatorio';
  end if;
  select precio_compra into v_costo from productos where id = p_producto_id and negocio_id = v_neg;
  if not found then raise exception 'El producto no existe'; end if;
  v_local := coalesce(p_local_id, mi_local(), local_principal(v_neg));
  if not local_de_mi_negocio(v_local) then
    raise exception 'El local no es válido';
  end if;

  insert into movimientos_inventario (negocio_id, producto_id, local_id, tipo, cantidad, costo_unitario, motivo,
                                      referencia_tipo, creado_por)
  values (v_neg, p_producto_id, v_local, p_tipo,
          case when p_tipo = 'ajuste_entrada' then p_cantidad else -p_cantidad end,
          v_costo, p_motivo, 'ajuste', auth.uid())
  returning id into v_mov;

  perform registrar_actividad('inventario.ajuste', 'productos', p_producto_id::text,
          jsonb_build_object('tipo', p_tipo, 'cantidad', p_cantidad, 'motivo', p_motivo, 'local', nombre_local(v_local)));
  return v_mov;
end $$;

-- ---------------------------------------------------------------------
-- 9. Trasladar mercancía entre locales
--    Equipos con serial: se indican las unidades (p_unidades); si no,
--    la cantidad.
-- ---------------------------------------------------------------------
create or replace function trasladar_inventario(
  p_producto_id bigint,
  p_origen      bigint,
  p_destino     bigint,
  p_cantidad    integer default null,
  p_unidades    bigint[] default null,
  p_motivo      text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_neg   integer := mi_negocio();
  v_prod  productos%rowtype;
  v_cant  integer;
  v_n     integer;
  v_texto text;
begin
  if v_neg is null or not tiene_permiso('editar_inventario') then
    raise exception 'No tienes permiso para trasladar inventario';
  end if;
  if p_origen is null or p_destino is null or p_origen = p_destino then
    raise exception 'Elige un local de origen y uno de destino diferentes';
  end if;
  if not local_de_mi_negocio(p_origen) or not local_de_mi_negocio(p_destino) then
    raise exception 'Los locales del traslado no son válidos';
  end if;
  select * into v_prod from productos where id = p_producto_id and negocio_id = v_neg for update;
  if not found then raise exception 'El producto no existe'; end if;

  if v_prod.maneja_serial then
    v_cant := coalesce(array_length(p_unidades, 1), 0);
    if v_cant = 0 then
      raise exception 'Elige los equipos (IMEI/serial) que vas a trasladar';
    end if;
    update unidades_serializadas set local_id = p_destino
     where id = any(p_unidades) and producto_id = v_prod.id and negocio_id = v_neg
       and estado = 'disponible' and local_id = p_origen;
    get diagnostics v_n = row_count;
    if v_n <> v_cant then
      raise exception 'Algún equipo elegido no está disponible en %', nombre_local(p_origen);
    end if;
  else
    v_cant := p_cantidad;
    if v_cant is null or v_cant <= 0 then
      raise exception 'La cantidad debe ser mayor que cero';
    end if;
  end if;

  v_texto := 'Traslado ' || nombre_local(p_origen) || ' → ' || nombre_local(p_destino)
             || coalesce(' · ' || nullif(trim(p_motivo), ''), '');
  insert into movimientos_inventario (negocio_id, producto_id, local_id, tipo, cantidad, costo_unitario, motivo,
                                      referencia_tipo, referencia_id, creado_por)
  values (v_neg, v_prod.id, p_origen, 'ajuste_salida', -v_cant, v_prod.precio_compra, v_texto, 'traslado', p_destino, auth.uid());
  insert into movimientos_inventario (negocio_id, producto_id, local_id, tipo, cantidad, costo_unitario, motivo,
                                      referencia_tipo, referencia_id, creado_por)
  values (v_neg, v_prod.id, p_destino, 'ajuste_entrada', v_cant, v_prod.precio_compra, v_texto, 'traslado', p_origen, auth.uid());

  perform registrar_actividad('inventario.traslado', 'productos', v_prod.id::text,
          jsonb_build_object('producto', v_prod.nombre, 'cantidad', v_cant,
                             'origen', nombre_local(p_origen), 'destino', nombre_local(p_destino), 'motivo', p_motivo));
  return v_cant;
end $$;

-- ---------------------------------------------------------------------
-- 10. Reportes por local
-- ---------------------------------------------------------------------
create or replace view facturas_netas with (security_invoker = on) as
select f.id, f.fecha, f.vendedor_id, f.cliente_id, f.estado,
       f.total - coalesce(d.total_devuelto, 0)                      as total_neto,
       f.costo_total - coalesce(d.costo_devuelto, 0)                as costo_neto,
       coalesce(f.comision, 0) - coalesce(d.comision_revertida, 0)  as comision_neta,
       f.local_id
from facturas f
left join lateral (
  select sum(dv.total_devuelto)      as total_devuelto,
         sum(dv.comision_revertida)  as comision_revertida,
         (select sum(di.cantidad * fi.costo_unitario)
            from devolucion_items di
            join factura_items fi on fi.id = di.factura_item_id
            join devoluciones dv2 on dv2.id = di.devolucion_id
           where dv2.factura_id = f.id and dv2.reintegra_stock) as costo_devuelto
  from devoluciones dv where dv.factura_id = f.id
) d on true;

drop function if exists ventas_por_empleado(date, date);
create or replace function ventas_por_empleado(p_desde date, p_hasta date, p_local_id bigint default null)
returns table (vendedor_id uuid, nombre text, facturas bigint, total_vendido numeric, comision numeric)
language sql stable security invoker set search_path = public as $$
  select fn.vendedor_id, pf.nombre, count(*), sum(fn.total_neto), sum(fn.comision_neta)
  from facturas_netas fn join perfiles pf on pf.id = fn.vendedor_id
  where fn.estado = 'emitida'
    and (fn.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_local_id is null or fn.local_id = p_local_id)
  group by fn.vendedor_id, pf.nombre
  order by 4 desc
$$;

drop function if exists resumen_dashboard();
create or replace function resumen_dashboard(p_local_id bigint default null)
returns table (
  ventas_hoy numeric, facturas_hoy bigint,
  ventas_mes numeric, facturas_mes bigint,
  ingresos_mes numeric, gastos_mes numeric, utilidad_mes numeric,
  valor_inventario numeric, productos_stock_bajo bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  tz constant text := 'America/Bogota';
  v_neg integer := mi_negocio();
  v_hoy date := hoy_tienda();
  v_mes date := date_trunc('month', hoy_tienda())::date;
  v_ventas_hoy numeric; v_fact_hoy bigint; v_ventas_mes numeric; v_fact_mes bigint; v_costo_mes numeric;
  v_ing_man numeric; v_gastos numeric; v_valor numeric; v_bajo bigint;
begin
  if v_neg is null or not (es_admin() or tiene_permiso('ver_finanzas')) then
    raise exception 'No tienes permiso para ver el dashboard';
  end if;
  if p_local_id is not null and not exists (select 1 from locales where id = p_local_id and negocio_id = v_neg) then
    raise exception 'El local no es válido';
  end if;

  select coalesce(sum(fn.total_neto) filter (where (fn.fecha at time zone tz)::date = v_hoy), 0),
         count(*)                    filter (where (fn.fecha at time zone tz)::date = v_hoy),
         coalesce(sum(fn.total_neto), 0), count(*), coalesce(sum(fn.costo_neto), 0)
    into v_ventas_hoy, v_fact_hoy, v_ventas_mes, v_fact_mes, v_costo_mes
    from facturas_netas fn join facturas f on f.id = fn.id
   where f.negocio_id = v_neg and fn.estado = 'emitida' and (fn.fecha at time zone tz)::date >= v_mes
     and (p_local_id is null or f.local_id = p_local_id);

  select coalesce(sum(monto) filter (where tipo = 'ingreso'), 0),
         coalesce(sum(monto) filter (where tipo = 'gasto'), 0)
    into v_ing_man, v_gastos
    from movimientos where negocio_id = v_neg and fecha >= v_mes
     and (p_local_id is null or local_id = p_local_id);

  if p_local_id is null then
    select coalesce(sum(stock * precio_compra), 0),
           count(*) filter (where stock <= stock_min)
      into v_valor, v_bajo
      from productos where negocio_id = v_neg and activo;
  else
    select coalesce(sum(s.stock * p.precio_compra), 0),
           count(*) filter (where s.stock <= p.stock_min)
      into v_valor, v_bajo
      from stock_local s join productos p on p.id = s.producto_id
     where s.local_id = p_local_id and p.activo;
  end if;

  return query select
    v_ventas_hoy, v_fact_hoy, v_ventas_mes, v_fact_mes,
    v_ventas_mes + v_ing_man, v_gastos,
    v_ventas_mes - v_costo_mes + v_ing_man - v_gastos,
    v_valor, v_bajo;
end $$;

-- ---------------------------------------------------------------------
-- 11. Factura pública: dirección y teléfono del local que vendió
-- ---------------------------------------------------------------------
create or replace function factura_publica(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e factura_enlaces%rowtype; f facturas%rowtype; l locales%rowtype;
begin
  if p_token is null or length(p_token) <> 12 then return null; end if;
  select * into e from factura_enlaces where token = p_token and vence_en > now();
  if not found then return null; end if;
  select * into f from facturas where id = e.factura_id;
  if not found then return null; end if;
  select * into l from locales where id = f.local_id;
  return jsonb_build_object(
    'factura', jsonb_build_object('id', f.id, 'prefijo', f.prefijo, 'numero', f.numero, 'fecha', f.fecha, 'estado', f.estado,
                                  'subtotal', f.subtotal, 'descuento', f.descuento, 'total', f.total,
                                  'metodo_pago', f.metodo_pago, 'notas', f.notas,
                                  'devuelto', (select coalesce(sum(total_devuelto), 0) from devoluciones where factura_id = f.id)),
    'cliente', (select jsonb_build_object('nombre', c.nombre, 'tipo_documento', c.tipo_documento, 'documento', c.documento,
                                          'telefono', c.telefono, 'correo', c.correo, 'direccion', c.direccion)
                  from clientes c where c.id = f.cliente_id),
    'vendedor', (select jsonb_build_object('nombre', p.nombre) from perfiles p where p.id = f.vendedor_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', i.cantidad,
                                                           'precio_unitario', i.precio_unitario, 'descuento', i.descuento) order by i.id), '[]'::jsonb)
                from factura_items i where i.factura_id = f.id),
    'tienda', (select jsonb_build_object('id', t.id, 'nombre', t.nombre, 'nit', t.nit,
                                         'direccion', coalesce(nullif(trim(l.direccion), ''), t.direccion),
                                         'telefono', coalesce(nullif(trim(l.telefono), ''), t.telefono),
                                         'correo', t.correo,
                                         'local', coalesce(nullif(trim(l.numero), ''), t.local),
                                         'sede', l.nombre,
                                         'datos_extra', t.datos_extra, 'factura_pie', t.factura_pie, 'logo_url', t.logo_url)
                 from tienda t where t.id = f.negocio_id)
  );
end $$;

-- ---------------------------------------------------------------------
-- 12. Seguridad (RLS)
-- ---------------------------------------------------------------------
alter table locales     enable row level security;
alter table stock_local enable row level security;

drop policy if exists locales_select on locales;
drop policy if exists locales_insert on locales;
drop policy if exists locales_update on locales;
create policy locales_select on locales for select to authenticated
  using (negocio_id = (select mi_negocio()) and es_activo());
create policy locales_insert on locales for insert to authenticated
  with check (negocio_id = (select mi_negocio()) and es_admin());
create policy locales_update on locales for update to authenticated
  using (negocio_id = (select mi_negocio()) and es_admin())
  with check (negocio_id = (select mi_negocio()) and es_admin());
-- (no hay política de borrar: un local se desactiva)

-- Todos los que ven inventario ven el stock de todos los locales; nadie lo escribe directo
drop policy if exists stock_local_select on stock_local;
create policy stock_local_select on stock_local for select to authenticated
  using (negocio_id = (select mi_negocio()) and tiene_permiso('ver_inventario'));

revoke all on locales, stock_local from anon;
grant select, insert, update on locales to authenticated;
grant select on stock_local to authenticated;
revoke insert, update, delete on stock_local from authenticated;

revoke all on function local_principal(integer)        from public, anon;
revoke all on function mi_local()                      from public, anon;
revoke all on function local_de_mi_negocio(bigint)     from public, anon;
revoke all on function nombre_local(bigint)            from public, anon;
revoke all on function tienda_crear_local()            from public, anon, authenticated;
revoke all on function locales_guard()                 from public, anon, authenticated;
revoke all on function perfiles_local_guard()          from public, anon, authenticated;
revoke all on function movimientos_local_guard()       from public, anon, authenticated;
grant execute on function local_principal(integer), mi_local(), local_de_mi_negocio(bigint), nombre_local(bigint) to authenticated;

revoke all on function emitir_factura(bigint, metodo_pago, jsonb, numeric, text, bigint) from public, anon;
revoke all on function emitir_factura_segura(text, bigint, metodo_pago, jsonb, numeric, text, bigint) from public, anon;
revoke all on function registrar_compra(bigint, text, forma_pago_compra, date, jsonb, jsonb, metodo_pago, bigint) from public, anon;
revoke all on function ajustar_inventario(bigint, integer, tipo_mov_inventario, text, bigint) from public, anon;
revoke all on function trasladar_inventario(bigint, bigint, bigint, integer, bigint[], text) from public, anon;
revoke all on function ventas_por_empleado(date, date, bigint) from public, anon;
revoke all on function resumen_dashboard(bigint) from public, anon;
grant execute on function emitir_factura(bigint, metodo_pago, jsonb, numeric, text, bigint) to authenticated;
grant execute on function emitir_factura_segura(text, bigint, metodo_pago, jsonb, numeric, text, bigint) to authenticated;
grant execute on function registrar_compra(bigint, text, forma_pago_compra, date, jsonb, jsonb, metodo_pago, bigint) to authenticated;
grant execute on function ajustar_inventario(bigint, integer, tipo_mov_inventario, text, bigint) to authenticated;
grant execute on function trasladar_inventario(bigint, bigint, bigint, integer, bigint[], text) to authenticated;
grant execute on function ventas_por_empleado(date, date, bigint) to authenticated;
grant execute on function resumen_dashboard(bigint) to authenticated;
grant execute on function factura_publica(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;

-- Verificación: debe mostrar tus locales y el stock total igual al de productos
select l.id, l.nombre, l.activo,
       (select coalesce(sum(s.stock), 0) from stock_local s where s.local_id = l.id) as unidades_en_stock
  from locales l order by l.negocio_id, l.id;
