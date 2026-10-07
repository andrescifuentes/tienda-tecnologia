-- =====================================================================
--  TechStore · Esquema de base de datos para Supabase (Postgres)
--  Ejecutar completo en: Supabase > SQL Editor > New query > Run
--  Contenido: tipos, tablas, restricciones, índices, triggers, funciones
--  de negocio (rpc), vistas, políticas RLS y datos iniciales.
-- =====================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------
-- 1. TIPOS (enums)
-- ---------------------------------------------------------------------
create type rol_usuario         as enum ('admin', 'vendedor');
create type permiso_tipo        as enum ('vender', 'ver_inventario', 'editar_inventario', 'editar_precios',
                                         'ver_costos', 'crear_clientes', 'hacer_devoluciones',
                                         'anular_facturas', 'registrar_compras', 'ver_finanzas');
create type tipo_mov_inventario as enum ('entrada_compra', 'salida_venta', 'devolucion_cliente',
                                         'devolucion_proveedor', 'ajuste_entrada', 'ajuste_salida');
create type metodo_pago         as enum ('efectivo', 'tarjeta', 'transferencia');
create type estado_factura      as enum ('emitida', 'anulada');
create type estado_unidad       as enum ('disponible', 'vendida', 'en_garantia', 'devuelta', 'baja');
create type estado_garantia     as enum ('vigente', 'en_reclamo', 'resuelta', 'vencida');
create type estado_reclamo      as enum ('abierto', 'en_revision', 'resuelto', 'rechazado');
create type canal_envio         as enum ('correo', 'whatsapp', 'descarga');
create type tipo_movimiento     as enum ('gasto', 'ingreso');
create type forma_pago_compra   as enum ('contado', 'credito');
create type estado_compra       as enum ('recibida', 'anulada');
create type tipo_documento      as enum ('CC', 'NIT', 'CE', 'PASAPORTE');

-- ---------------------------------------------------------------------
-- 2. TABLAS
-- ---------------------------------------------------------------------

-- 2.1 Personas ---------------------------------------------------------
create table perfiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  nombre        text not null,
  correo        text not null unique,
  telefono      text,
  rol           rol_usuario not null default 'vendedor',
  comision_pct  numeric(5,2) check (comision_pct is null or comision_pct between 0 and 100),
  activo        boolean not null default true,
  creado_en     timestamptz not null default now(),
  creado_por    uuid references perfiles(id)
);
comment on column perfiles.comision_pct is 'Vacío = el empleado no gana comisión.';

create table perfil_permisos (
  perfil_id uuid not null references perfiles(id) on delete cascade,
  permiso   permiso_tipo not null,
  primary key (perfil_id, permiso)
);

create table actividad (
  id         bigint generated always as identity primary key,
  perfil_id  uuid references perfiles(id) on delete set null,
  accion     text not null,
  entidad    text,
  entidad_id text,
  detalle    jsonb,
  fecha      timestamptz not null default now()
);

-- 2.2 Inventario -------------------------------------------------------
create table categorias (
  id     bigint generated always as identity primary key,
  nombre text not null unique,
  activa boolean not null default true
);

create table proveedores (
  id        bigint generated always as identity primary key,
  nombre    text not null,
  nit       text,
  contacto  text,
  telefono  text,
  correo    text,
  direccion text,
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

create table productos (
  id             bigint generated always as identity primary key,
  codigo         text not null unique,
  codigo_barras  text unique,
  nombre         text not null,
  marca          text,
  categoria_id   bigint references categorias(id),
  proveedor_id   bigint references proveedores(id),
  precio_compra  numeric(12,0) not null default 0 check (precio_compra >= 0),
  precio_venta   numeric(12,0) not null default 0 check (precio_venta >= 0),
  stock          integer not null default 0 check (stock >= 0),
  stock_min      integer not null default 3 check (stock_min >= 0),
  maneja_serial  boolean not null default false,
  garantia_meses integer not null default 0 check (garantia_meses >= 0),
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on column productos.stock is 'Solo cambia por filas en movimientos_inventario (lo calcula un trigger).';

create table unidades_serializadas (
  id              bigint generated always as identity primary key,
  producto_id     bigint not null references productos(id),
  serial          text not null unique,
  estado          estado_unidad not null default 'disponible',
  compra_item_id  bigint,   -- FK se agrega más abajo (dependencia circular)
  factura_item_id bigint,   -- FK se agrega más abajo
  creado_en       timestamptz not null default now()
);

create table movimientos_inventario (
  id              bigint generated always as identity primary key,
  producto_id     bigint not null references productos(id),
  tipo            tipo_mov_inventario not null,
  cantidad        integer not null check (cantidad <> 0),
  costo_unitario  numeric(12,0),
  stock_despues   integer,
  motivo          text,
  referencia_tipo text,
  referencia_id   bigint,
  creado_por      uuid references perfiles(id),
  fecha           timestamptz not null default now(),
  check ((tipo in ('entrada_compra','devolucion_cliente','ajuste_entrada') and cantidad > 0)
      or (tipo in ('salida_venta','devolucion_proveedor','ajuste_salida') and cantidad < 0))
);

-- 2.3 Compras ----------------------------------------------------------
create table compras (
  id               bigint generated always as identity primary key,
  proveedor_id     bigint not null references proveedores(id),
  numero_documento text,
  fecha            date not null default current_date,
  forma_pago       forma_pago_compra not null default 'contado',
  vence_el         date,
  total            numeric(12,0) not null default 0 check (total >= 0),
  estado           estado_compra not null default 'recibida',
  registrado_por   uuid references perfiles(id),
  creado_en        timestamptz not null default now(),
  check (forma_pago = 'contado' or vence_el is not null)
);

create table compra_items (
  id             bigint generated always as identity primary key,
  compra_id      bigint not null references compras(id) on delete cascade,
  producto_id    bigint not null references productos(id),
  cantidad       integer not null check (cantidad > 0),
  costo_unitario numeric(12,0) not null check (costo_unitario >= 0)
);

create table pagos_proveedor (
  id             bigint generated always as identity primary key,
  compra_id      bigint not null references compras(id),
  monto          numeric(12,0) not null check (monto > 0),
  metodo_pago    metodo_pago not null default 'efectivo',
  fecha          timestamptz not null default now(),
  registrado_por uuid references perfiles(id)
);

-- 2.4 Facturación ------------------------------------------------------
create table clientes (
  id             bigint generated always as identity primary key,
  tipo_documento tipo_documento not null default 'CC',
  documento      text not null,
  nombre         text not null,
  telefono       text,
  correo         text,
  direccion      text,
  creado_por     uuid references perfiles(id),
  creado_en      timestamptz not null default now(),
  unique (tipo_documento, documento)
);

create table facturas (
  id               bigint generated always as identity primary key,
  prefijo          text not null,
  numero           integer not null,
  cliente_id       bigint references clientes(id),   -- vacío = consumidor final
  vendedor_id      uuid not null references perfiles(id),
  subtotal         numeric(12,0) not null default 0,
  descuento        numeric(12,0) not null default 0,
  total            numeric(12,0) not null default 0,
  costo_total      numeric(12,0) not null default 0,
  metodo_pago      metodo_pago not null,
  comision_pct     numeric(5,2),
  comision         numeric(12,0),
  estado           estado_factura not null default 'emitida',
  fecha            timestamptz not null default now(),
  notas            text,
  anulada_por      uuid references perfiles(id),
  anulada_en       timestamptz,
  motivo_anulacion text,
  unique (prefijo, numero)
);

create table factura_items (
  id              bigint generated always as identity primary key,
  factura_id      bigint not null references facturas(id) on delete cascade,
  producto_id     bigint not null references productos(id),
  unidad_id       bigint references unidades_serializadas(id),
  nombre          text not null,
  cantidad        integer not null check (cantidad > 0),
  precio_unitario numeric(12,0) not null,
  descuento       numeric(12,0) not null default 0 check (descuento >= 0),
  costo_unitario  numeric(12,0) not null default 0
);
comment on column factura_items.descuento is 'Descuento total de la línea (no por unidad).';

alter table unidades_serializadas
  add constraint unidades_compra_item_fk  foreign key (compra_item_id)  references compra_items(id),
  add constraint unidades_factura_item_fk foreign key (factura_item_id) references factura_items(id);

create table factura_envios (
  id         bigint generated always as identity primary key,
  factura_id bigint not null references facturas(id) on delete cascade,
  canal      canal_envio not null,
  destino    text,
  enviado_por uuid references perfiles(id),
  fecha      timestamptz not null default now()
);

create table devoluciones (
  id                bigint generated always as identity primary key,
  factura_id        bigint not null references facturas(id),
  motivo            text not null,
  reintegra_stock   boolean not null default true,
  total_devuelto    numeric(12,0) not null default 0,
  comision_revertida numeric(12,0) not null default 0,
  creado_por        uuid references perfiles(id),
  fecha             timestamptz not null default now()
);

create table devolucion_items (
  id              bigint generated always as identity primary key,
  devolucion_id   bigint not null references devoluciones(id) on delete cascade,
  factura_item_id bigint not null references factura_items(id),
  cantidad        integer not null check (cantidad > 0),
  monto           numeric(12,0) not null default 0
);

-- 2.5 Garantías --------------------------------------------------------
create table garantias (
  id              bigint generated always as identity primary key,
  factura_item_id bigint not null references factura_items(id),
  producto_id     bigint not null references productos(id),
  cliente_id      bigint references clientes(id),
  unidad_id       bigint references unidades_serializadas(id),
  inicio          date not null,
  fin             date not null,
  estado          estado_garantia not null default 'vigente',
  check (fin >= inicio - 1)
);

create table reclamos_garantia (
  id          bigint generated always as identity primary key,
  garantia_id bigint not null references garantias(id),
  descripcion text not null,
  estado      estado_reclamo not null default 'abierto',
  resolucion  text,
  resuelto_en timestamptz,
  creado_por  uuid references perfiles(id),
  fecha       timestamptz not null default now()
);

-- 2.6 Finanzas y configuración ----------------------------------------
create table movimientos (
  id             bigint generated always as identity primary key,
  tipo           tipo_movimiento not null,
  categoria      text not null,
  descripcion    text,
  monto          numeric(12,0) not null check (monto > 0),
  fecha          date not null default current_date,
  registrado_por uuid references perfiles(id)
);

create table tienda (
  id                    smallint primary key default 1 check (id = 1),
  nombre                text not null default 'TechStore',
  nit                   text,
  direccion             text,
  telefono              text,
  correo                text,
  moneda                text not null default 'COP',
  zona_horaria          text not null default 'America/Bogota',
  factura_prefijo       text not null default 'FV',
  ultimo_numero_factura integer not null default 0,
  factura_pie           text
);

-- ---------------------------------------------------------------------
-- 3. ÍNDICES
-- ---------------------------------------------------------------------
create index idx_productos_nombre_trgm   on productos using gin (nombre gin_trgm_ops);
create index idx_productos_categoria     on productos (categoria_id);
create index idx_movinv_producto_fecha   on movimientos_inventario (producto_id, fecha desc);
create index idx_unidades_producto       on unidades_serializadas (producto_id, estado);
create index idx_facturas_fecha          on facturas (fecha);
create index idx_facturas_vendedor_fecha on facturas (vendedor_id, fecha);
create index idx_facturas_cliente        on facturas (cliente_id);
create index idx_factura_items_factura   on factura_items (factura_id);
create index idx_factura_items_producto  on factura_items (producto_id);
create index idx_clientes_nombre_trgm    on clientes using gin (nombre gin_trgm_ops);
create index idx_compras_proveedor       on compras (proveedor_id, fecha desc);
create index idx_pagos_compra            on pagos_proveedor (compra_id);
create index idx_movimientos_fecha       on movimientos (fecha);
create index idx_garantias_estado_fin    on garantias (estado, fin);
create index idx_actividad_fecha         on actividad (fecha desc);

-- ---------------------------------------------------------------------
-- 4. FUNCIONES AUXILIARES (permisos y utilidades)
-- ---------------------------------------------------------------------
create or replace function hoy_tienda() returns date
language sql stable as $$
  select (now() at time zone 'America/Bogota')::date
$$;

create or replace function es_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo)
$$;

create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo and rol = 'admin')
$$;

create or replace function tiene_permiso(p permiso_tipo) returns boolean
language sql stable security definer set search_path = public as $$
  select es_admin() or exists (
    select 1
    from perfil_permisos pp join perfiles pf on pf.id = pp.perfil_id
    where pp.perfil_id = auth.uid() and pp.permiso = p and pf.activo
  )
$$;

create or replace function registrar_actividad(p_accion text, p_entidad text, p_entidad_id text, p_detalle jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into actividad (perfil_id, accion, entidad, entidad_id, detalle)
  values (auth.uid(), p_accion, p_entidad, p_entidad_id, p_detalle)
$$;

-- ---------------------------------------------------------------------
-- 5. TRIGGERS
-- ---------------------------------------------------------------------

-- 5.1 Permisos por defecto para vendedores nuevos
create or replace function perfiles_permisos_por_defecto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rol = 'vendedor' then
    insert into perfil_permisos (perfil_id, permiso)
    values (new.id, 'vender'), (new.id, 'ver_inventario'), (new.id, 'crear_clientes')
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger trg_perfiles_permisos after insert on perfiles
  for each row execute function perfiles_permisos_por_defecto();

-- 5.2 Protección de productos: el stock solo cambia por movimientos
create or replace function productos_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.actualizado_en := now();
  if tg_op = 'INSERT' then
    if new.stock <> 0 then
      raise exception 'El stock inicial se carga con una compra o un ajuste de entrada';
    end if;
    return new;
  end if;
  if new.stock is distinct from old.stock and pg_trigger_depth() = 1 then
    raise exception 'El stock solo cambia mediante movimientos de inventario';
  end if;
  if (new.precio_venta is distinct from old.precio_venta
      or new.precio_compra is distinct from old.precio_compra)
     and auth.uid() is not null
     and coalesce(current_setting('app.bypass_precios', true), '') <> '1'
     and not tiene_permiso('editar_precios') then
    raise exception 'No tienes permiso para cambiar precios';
  end if;
  return new;
end $$;
create trigger trg_productos_guard before insert or update on productos
  for each row execute function productos_guard();

-- 5.3 Movimientos de inventario: aplican el stock y son inmodificables
create or replace function aplicar_movimiento_inventario() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_stock integer;
begin
  select stock into v_stock from productos where id = new.producto_id for update;
  if not found then
    raise exception 'El producto % no existe', new.producto_id;
  end if;
  new.stock_despues := v_stock + new.cantidad;
  if new.stock_despues < 0 then
    raise exception 'Stock insuficiente para el producto % (disponible %, solicitado %)',
      new.producto_id, v_stock, -new.cantidad;
  end if;
  update productos set stock = new.stock_despues where id = new.producto_id;
  return new;
end $$;
create trigger trg_movinv_aplicar before insert on movimientos_inventario
  for each row execute function aplicar_movimiento_inventario();

create or replace function bloquear_modificacion() returns trigger
language plpgsql as $$
begin
  raise exception 'La tabla % es un historial y no se puede modificar ni borrar', tg_table_name;
end $$;
create trigger trg_movinv_inmutable before update or delete on movimientos_inventario
  for each row execute function bloquear_modificacion();
create trigger trg_actividad_inmutable before update or delete on actividad
  for each row execute function bloquear_modificacion();

-- 5.4 Auditoría automática (historial de actividad)
create or replace function auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'productos'
     and (to_jsonb(new) - 'stock' - 'actualizado_en') = (to_jsonb(old) - 'stock' - 'actualizado_en') then
    return new;   -- cambio solo de stock: ya queda en movimientos_inventario
  end if;
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id');
  insert into actividad (perfil_id, accion, entidad, entidad_id, detalle)
  values (auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, v_id,
          jsonb_build_object('antes',   case when tg_op <> 'INSERT' then to_jsonb(old) end,
                             'despues', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  return coalesce(new, old);
end $$;
create trigger trg_audit_productos   after insert or update or delete on productos   for each row execute function auditar();
create trigger trg_audit_perfiles    after insert or update or delete on perfiles    for each row execute function auditar();
create trigger trg_audit_clientes    after insert or update or delete on clientes    for each row execute function auditar();
create trigger trg_audit_proveedores after insert or update or delete on proveedores for each row execute function auditar();
create trigger trg_audit_movimientos after insert or update or delete on movimientos for each row execute function auditar();

-- ---------------------------------------------------------------------
-- 6. FUNCIONES DE NEGOCIO (se llaman con supabase.rpc)
-- ---------------------------------------------------------------------

-- 6.1 Emitir factura -------------------------------------------------
-- p_items = [{"producto_id":1,"cantidad":2,"descuento":0}, {"producto_id":7,"cantidad":1,"unidad_id":15}]
-- Productos con serial: una fila por equipo, con su unidad_id y cantidad 1.
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
  v_pct        numeric;
  v_comision   numeric;
begin
  if not tiene_permiso('vender') then
    raise exception 'No tienes permiso para vender';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La factura necesita al menos un producto';
  end if;
  if coalesce(p_descuento, 0) < 0 then
    raise exception 'El descuento no puede ser negativo';
  end if;
  if coalesce(p_descuento, 0) > 0 and not tiene_permiso('editar_precios') then
    raise exception 'No tienes permiso para aplicar descuentos';
  end if;

  update tienda set ultimo_numero_factura = ultimo_numero_factura + 1
   where id = 1
   returning factura_prefijo, ultimo_numero_factura into v_prefijo, v_numero;

  insert into facturas (prefijo, numero, cliente_id, vendedor_id, metodo_pago, notas)
  values (v_prefijo, v_numero, p_cliente_id, v_uid, p_metodo_pago, p_notas)
  returning id into v_factura;

  for it in select e from jsonb_array_elements(p_items) e loop
    v_cant := coalesce((it->>'cantidad')::integer, 1);
    v_desc := coalesce((it->>'descuento')::numeric, 0);
    if v_cant <= 0 then
      raise exception 'La cantidad debe ser mayor que cero';
    end if;
    if v_desc < 0 or (v_desc > 0 and not tiene_permiso('editar_precios')) then
      raise exception 'Descuento no permitido en el producto %', it->>'producto_id';
    end if;

    select * into v_prod from productos
     where id = (it->>'producto_id')::bigint and activo for update;
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

    insert into factura_items (factura_id, producto_id, unidad_id, nombre, cantidad,
                               precio_unitario, descuento, costo_unitario)
    values (v_factura, v_prod.id, v_unidad.id, v_prod.nombre, v_cant,
            v_prod.precio_venta, v_desc, v_prod.precio_compra)
    returning id into v_item;

    if v_unidad.id is not null then
      update unidades_serializadas set estado = 'vendida', factura_item_id = v_item
       where id = v_unidad.id;
    end if;

    insert into movimientos_inventario (producto_id, tipo, cantidad, costo_unitario,
                                        referencia_tipo, referencia_id, creado_por)
    values (v_prod.id, 'salida_venta', -v_cant, v_prod.precio_compra, 'factura', v_factura, v_uid);

    if v_prod.garantia_meses > 0 then
      insert into garantias (factura_item_id, producto_id, cliente_id, unidad_id, inicio, fin)
      values (v_item, v_prod.id, p_cliente_id, v_unidad.id, hoy_tienda(),
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

  select comision_pct into v_pct from perfiles where id = v_uid;
  v_comision := case when v_pct is null then null else round(v_total * v_pct / 100) end;

  update facturas
     set subtotal = v_subtotal, descuento = v_desc_total, total = v_total,
         costo_total = v_costo, comision_pct = v_pct, comision = v_comision
   where id = v_factura;

  perform registrar_actividad('factura.emitida', 'facturas', v_factura::text,
          jsonb_build_object('numero', v_prefijo || v_numero, 'total', v_total));
  return v_factura;
end $$;

-- 6.2 Anular factura -------------------------------------------------
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
  select * into f from facturas where id = p_factura_id for update;
  if not found then raise exception 'La factura no existe'; end if;
  if f.estado = 'anulada' then raise exception 'La factura ya está anulada'; end if;
  if exists (select 1 from devoluciones where factura_id = f.id) then
    raise exception 'La factura tiene devoluciones y no se puede anular';
  end if;

  update facturas
     set estado = 'anulada', anulada_por = auth.uid(), anulada_en = now(), motivo_anulacion = p_motivo
   where id = f.id;

  for it in select * from factura_items where factura_id = f.id loop
    insert into movimientos_inventario (producto_id, tipo, cantidad, costo_unitario, motivo,
                                        referencia_tipo, referencia_id, creado_por)
    values (it.producto_id, 'devolucion_cliente', it.cantidad, it.costo_unitario,
            'Anulación de factura ' || f.prefijo || f.numero, 'factura', f.id, auth.uid());
  end loop;

  update unidades_serializadas set estado = 'disponible', factura_item_id = null
   where factura_item_id in (select id from factura_items where factura_id = f.id);
  update garantias set estado = 'vencida', fin = least(fin, hoy_tienda())
   where factura_item_id in (select id from factura_items where factura_id = f.id);

  perform registrar_actividad('factura.anulada', 'facturas', f.id::text,
          jsonb_build_object('numero', f.prefijo || f.numero, 'motivo', p_motivo));
end $$;

-- 6.3 Devolución parcial o total ---------------------------------------
-- p_items = [{"factura_item_id":10,"cantidad":1}]
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
  v_com    numeric := 0;
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
  select * into f from facturas where id = p_factura_id for update;
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
      insert into movimientos_inventario (producto_id, tipo, cantidad, costo_unitario, motivo,
                                          referencia_tipo, referencia_id, creado_por)
      values (fi.producto_id, 'devolucion_cliente', v_cant, fi.costo_unitario,
              'Devolución de factura ' || f.prefijo || f.numero, 'devolucion', v_dev, auth.uid());
      update unidades_serializadas set estado = 'disponible', factura_item_id = null
       where factura_item_id = fi.id;
    else
      update unidades_serializadas set estado = 'devuelta' where factura_item_id = fi.id;
    end if;

    update garantias set estado = 'vencida', fin = least(fin, hoy_tienda())
     where factura_item_id = fi.id;
  end loop;

  v_com := case when f.comision_pct is null then 0 else round(v_total * f.comision_pct / 100) end;
  update devoluciones set total_devuelto = v_total, comision_revertida = v_com where id = v_dev;

  perform registrar_actividad('factura.devolucion', 'devoluciones', v_dev::text,
          jsonb_build_object('factura', f.prefijo || f.numero, 'total_devuelto', v_total));
  return v_dev;
end $$;

-- 6.4 Compras (ingreso de mercancía) -------------------------------------
-- p_items    = [{"producto_id":1,"cantidad":5,"costo_unitario":3100000}]
-- p_seriales = [{"producto_id":1,"serial":"356938035643809"}, ...]  (productos con serial)
create or replace function registrar_compra(
  p_proveedor_id     bigint,
  p_numero_documento text,
  p_forma_pago       forma_pago_compra,
  p_vence_el         date,
  p_items            jsonb,
  p_seriales         jsonb default '[]'::jsonb,
  p_metodo_pago      metodo_pago default 'efectivo'
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
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
  if not tiene_permiso('registrar_compras') then
    raise exception 'No tienes permiso para registrar compras';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La compra necesita al menos un producto';
  end if;
  if p_forma_pago = 'credito' and p_vence_el is null then
    raise exception 'Una compra a crédito necesita fecha de vencimiento';
  end if;

  perform set_config('app.bypass_precios', '1', true);

  insert into compras (proveedor_id, numero_documento, forma_pago, vence_el, registrado_por, fecha)
  values (p_proveedor_id, p_numero_documento, p_forma_pago, p_vence_el, auth.uid(), hoy_tienda())
  returning id into v_compra;

  for it in select e from jsonb_array_elements(p_items) e loop
    v_cant  := (it->>'cantidad')::integer;
    v_costo := (it->>'costo_unitario')::numeric;
    if v_cant is null or v_cant <= 0 or v_costo is null or v_costo < 0 then
      raise exception 'Cantidad o costo inválido en la compra';
    end if;
    select * into v_prod from productos where id = (it->>'producto_id')::bigint and activo for update;
    if not found then raise exception 'El producto % no está disponible', it->>'producto_id'; end if;

    insert into compra_items (compra_id, producto_id, cantidad, costo_unitario)
    values (v_compra, v_prod.id, v_cant, v_costo)
    returning id into v_item;

    if v_prod.maneja_serial then
      v_n := 0;
      for s in select e from jsonb_array_elements(p_seriales) e
                where (e->>'producto_id')::bigint = v_prod.id loop
        insert into unidades_serializadas (producto_id, serial, compra_item_id)
        values (v_prod.id, trim(s->>'serial'), v_item);
        v_n := v_n + 1;
      end loop;
      if v_n <> v_cant then
        raise exception 'El producto "%" requiere % seriales y recibió %', v_prod.nombre, v_cant, v_n;
      end if;
    end if;

    insert into movimientos_inventario (producto_id, tipo, cantidad, costo_unitario,
                                        referencia_tipo, referencia_id, creado_por)
    values (v_prod.id, 'entrada_compra', v_cant, v_costo, 'compra', v_compra, auth.uid());

    update productos set precio_compra = v_costo where id = v_prod.id;  -- último costo
    v_total := v_total + v_cant * v_costo;
  end loop;

  update compras set total = v_total where id = v_compra;
  if p_forma_pago = 'contado' then
    insert into pagos_proveedor (compra_id, monto, metodo_pago, registrado_por)
    values (v_compra, v_total, p_metodo_pago, auth.uid());
  end if;

  perform registrar_actividad('compra.registrada', 'compras', v_compra::text,
          jsonb_build_object('proveedor_id', p_proveedor_id, 'total', v_total));
  return v_compra;
end $$;

-- 6.5 Abono a proveedor (cuentas por pagar) --------------------------------
create or replace function registrar_pago_proveedor(
  p_compra_id   bigint,
  p_monto       numeric,
  p_metodo_pago metodo_pago default 'efectivo'
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  c       compras%rowtype;
  v_saldo numeric;
  v_pago  bigint;
begin
  if not tiene_permiso('registrar_compras') then
    raise exception 'No tienes permiso para registrar pagos a proveedores';
  end if;
  select * into c from compras where id = p_compra_id for update;
  if not found then raise exception 'La compra no existe'; end if;
  select c.total - coalesce(sum(monto), 0) into v_saldo from pagos_proveedor where compra_id = c.id;
  if p_monto is null or p_monto <= 0 or p_monto > v_saldo then
    raise exception 'El abono debe ser mayor que 0 y no superar el saldo (%)', v_saldo;
  end if;
  insert into pagos_proveedor (compra_id, monto, metodo_pago, registrado_por)
  values (c.id, p_monto, p_metodo_pago, auth.uid())
  returning id into v_pago;
  perform registrar_actividad('compra.pago', 'pagos_proveedor', v_pago::text,
          jsonb_build_object('compra_id', c.id, 'monto', p_monto));
  return v_pago;
end $$;

-- 6.6 Ajustes y salidas de inventario ----------------------------------------
-- Tipos permitidos: ajuste_entrada, ajuste_salida, devolucion_proveedor. p_cantidad siempre positiva.
create or replace function ajustar_inventario(
  p_producto_id bigint,
  p_cantidad    integer,
  p_tipo        tipo_mov_inventario,
  p_motivo      text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
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
  select precio_compra into v_costo from productos where id = p_producto_id;
  if not found then raise exception 'El producto no existe'; end if;

  insert into movimientos_inventario (producto_id, tipo, cantidad, costo_unitario, motivo,
                                      referencia_tipo, creado_por)
  values (p_producto_id, p_tipo,
          case when p_tipo = 'ajuste_entrada' then p_cantidad else -p_cantidad end,
          v_costo, p_motivo, 'ajuste', auth.uid())
  returning id into v_mov;

  perform registrar_actividad('inventario.ajuste', 'productos', p_producto_id::text,
          jsonb_build_object('tipo', p_tipo, 'cantidad', p_cantidad, 'motivo', p_motivo));
  return v_mov;
end $$;

-- ---------------------------------------------------------------------
-- 7. VISTAS Y FUNCIONES DE CONSULTA
-- ---------------------------------------------------------------------

-- Productos sin costos, para vendedores (vista definer: no expone precio_compra)
create or replace view productos_venta as
select p.id, p.codigo, p.codigo_barras, p.nombre, p.marca,
       c.nombre as categoria, p.precio_venta, p.stock, p.stock_min,
       p.maneja_serial, p.garantia_meses
from productos p
left join categorias c on c.id = p.categoria_id
where p.activo and tiene_permiso('ver_inventario');

-- Facturas con devoluciones descontadas (respeta RLS de quien consulta)
create or replace view facturas_netas with (security_invoker = on) as
select f.id, f.fecha, f.vendedor_id, f.cliente_id, f.estado,
       f.total - coalesce(d.total_devuelto, 0)                      as total_neto,
       f.costo_total - coalesce(d.costo_devuelto, 0)                as costo_neto,
       coalesce(f.comision, 0) - coalesce(d.comision_revertida, 0)  as comision_neta
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

create or replace view stock_bajo with (security_invoker = on) as
select id, codigo, nombre, stock, stock_min
from productos where activo and stock <= stock_min;

create or replace view compras_saldo with (security_invoker = on) as
select c.*, c.total - coalesce(sum(p.monto), 0) as saldo
from compras c left join pagos_proveedor p on p.compra_id = c.id
group by c.id;

-- Ventas por empleado en un rango de fechas (cada vendedor solo ve las suyas por RLS)
create or replace function ventas_por_empleado(p_desde date, p_hasta date)
returns table (vendedor_id uuid, nombre text, facturas bigint, total_vendido numeric, comision numeric)
language sql stable security invoker set search_path = public as $$
  select fn.vendedor_id, pf.nombre, count(*), sum(fn.total_neto), sum(fn.comision_neta)
  from facturas_netas fn join perfiles pf on pf.id = fn.vendedor_id
  where fn.estado = 'emitida'
    and (fn.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
  group by fn.vendedor_id, pf.nombre
  order by 4 desc
$$;

-- Dashboard del administrador
create or replace function resumen_dashboard()
returns table (
  ventas_hoy numeric, facturas_hoy bigint,
  ventas_mes numeric, facturas_mes bigint,
  ingresos_mes numeric, gastos_mes numeric, utilidad_mes numeric,
  valor_inventario numeric, productos_stock_bajo bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  tz constant text := 'America/Bogota';
  v_hoy date := hoy_tienda();
  v_mes date := date_trunc('month', hoy_tienda())::date;
  v_ventas_hoy numeric; v_fact_hoy bigint; v_ventas_mes numeric; v_fact_mes bigint; v_costo_mes numeric;
  v_ing_man numeric; v_gastos numeric;
begin
  if not (es_admin() or tiene_permiso('ver_finanzas')) then
    raise exception 'No tienes permiso para ver el dashboard';
  end if;

  select coalesce(sum(total_neto) filter (where (fecha at time zone tz)::date = v_hoy), 0),
         count(*)                 filter (where (fecha at time zone tz)::date = v_hoy),
         coalesce(sum(total_neto), 0), count(*), coalesce(sum(costo_neto), 0)
    into v_ventas_hoy, v_fact_hoy, v_ventas_mes, v_fact_mes, v_costo_mes
    from facturas_netas
   where estado = 'emitida' and (fecha at time zone tz)::date >= v_mes;

  select coalesce(sum(monto) filter (where tipo = 'ingreso'), 0),
         coalesce(sum(monto) filter (where tipo = 'gasto'), 0)
    into v_ing_man, v_gastos
    from movimientos where fecha >= v_mes;

  return query select
    v_ventas_hoy, v_fact_hoy, v_ventas_mes, v_fact_mes,
    v_ventas_mes + v_ing_man, v_gastos,
    v_ventas_mes - v_costo_mes + v_ing_man - v_gastos,
    (select coalesce(sum(stock * precio_compra), 0) from productos where activo),
    (select count(*) from productos where activo and stock <= stock_min);
end $$;

-- ---------------------------------------------------------------------
-- 8. SEGURIDAD: RLS
-- ---------------------------------------------------------------------
alter table perfiles               enable row level security;
alter table perfil_permisos        enable row level security;
alter table actividad              enable row level security;
alter table categorias             enable row level security;
alter table proveedores            enable row level security;
alter table productos              enable row level security;
alter table unidades_serializadas  enable row level security;
alter table movimientos_inventario enable row level security;
alter table compras                enable row level security;
alter table compra_items           enable row level security;
alter table pagos_proveedor        enable row level security;
alter table clientes               enable row level security;
alter table facturas               enable row level security;
alter table factura_items          enable row level security;
alter table factura_envios         enable row level security;
alter table devoluciones           enable row level security;
alter table devolucion_items       enable row level security;
alter table garantias              enable row level security;
alter table reclamos_garantia      enable row level security;
alter table movimientos            enable row level security;
alter table tienda                 enable row level security;

-- Personas
create policy perfiles_select on perfiles for select to authenticated using (id = auth.uid() or es_admin());
create policy perfiles_admin  on perfiles for all    to authenticated using (es_admin()) with check (es_admin());
create policy permisos_select on perfil_permisos for select to authenticated using (perfil_id = auth.uid() or es_admin());
create policy permisos_admin  on perfil_permisos for all    to authenticated using (es_admin()) with check (es_admin());
create policy actividad_select on actividad for select to authenticated using (es_admin());

-- Inventario
create policy categorias_select on categorias for select to authenticated using (es_activo());
create policy categorias_write  on categorias for all    to authenticated
  using (tiene_permiso('editar_inventario')) with check (tiene_permiso('editar_inventario'));

create policy proveedores_select on proveedores for select to authenticated
  using (tiene_permiso('registrar_compras') or tiene_permiso('editar_inventario'));
create policy proveedores_write  on proveedores for all to authenticated
  using (tiene_permiso('registrar_compras')) with check (tiene_permiso('registrar_compras'));

create policy productos_select on productos for select to authenticated
  using (tiene_permiso('ver_costos') or tiene_permiso('editar_inventario'));
create policy productos_insert on productos for insert to authenticated with check (tiene_permiso('editar_inventario'));
create policy productos_update on productos for update to authenticated
  using (tiene_permiso('editar_inventario')) with check (tiene_permiso('editar_inventario'));
create policy productos_delete on productos for delete to authenticated using (es_admin());

create policy unidades_select on unidades_serializadas for select to authenticated using (tiene_permiso('ver_inventario'));
create policy unidades_insert on unidades_serializadas for insert to authenticated with check (tiene_permiso('editar_inventario'));
create policy unidades_update on unidades_serializadas for update to authenticated
  using (tiene_permiso('editar_inventario')) with check (tiene_permiso('editar_inventario'));

create policy movinv_select on movimientos_inventario for select to authenticated using (tiene_permiso('editar_inventario'));

-- Compras
create policy compras_select  on compras         for select to authenticated using (tiene_permiso('registrar_compras'));
create policy compraitems_sel on compra_items    for select to authenticated using (tiene_permiso('registrar_compras'));
create policy pagosprov_sel   on pagos_proveedor for select to authenticated using (tiene_permiso('registrar_compras'));

-- Clientes y facturación
create policy clientes_select on clientes for select to authenticated using (es_activo());
create policy clientes_insert on clientes for insert to authenticated with check (tiene_permiso('crear_clientes'));
create policy clientes_update on clientes for update to authenticated
  using (tiene_permiso('crear_clientes')) with check (tiene_permiso('crear_clientes'));
create policy clientes_delete on clientes for delete to authenticated using (es_admin());

create policy facturas_select on facturas for select to authenticated
  using (es_admin() or (es_activo() and vendedor_id = auth.uid()));
create policy factura_items_select on factura_items for select to authenticated
  using (exists (select 1 from facturas f where f.id = factura_id));
create policy envios_select on factura_envios for select to authenticated
  using (exists (select 1 from facturas f where f.id = factura_id));
create policy envios_insert on factura_envios for insert to authenticated
  with check (enviado_por = auth.uid() and exists (select 1 from facturas f where f.id = factura_id));
create policy devoluciones_select on devoluciones for select to authenticated
  using (exists (select 1 from facturas f where f.id = factura_id));
create policy devitems_select on devolucion_items for select to authenticated
  using (exists (select 1 from devoluciones d where d.id = devolucion_id));

-- Garantías
create policy garantias_select on garantias for select to authenticated using (tiene_permiso('ver_inventario'));
create policy garantias_update on garantias for update to authenticated
  using (tiene_permiso('editar_inventario')) with check (tiene_permiso('editar_inventario'));
create policy reclamos_select on reclamos_garantia for select to authenticated using (tiene_permiso('ver_inventario'));
create policy reclamos_insert on reclamos_garantia for insert to authenticated
  with check (tiene_permiso('editar_inventario') and creado_por = auth.uid());
create policy reclamos_update on reclamos_garantia for update to authenticated
  using (tiene_permiso('editar_inventario')) with check (tiene_permiso('editar_inventario'));

-- Finanzas y tienda
create policy movimientos_all on movimientos for all to authenticated
  using (tiene_permiso('ver_finanzas')) with check (tiene_permiso('ver_finanzas'));
create policy tienda_select on tienda for select to authenticated using (es_activo());
create policy tienda_update on tienda for update to authenticated using (es_admin()) with check (es_admin());

-- ---------------------------------------------------------------------
-- 9. PERMISOS DE EJECUCIÓN
-- ---------------------------------------------------------------------
revoke all on function emitir_factura(bigint, metodo_pago, jsonb, numeric, text)            from public, anon;
revoke all on function anular_factura(bigint, text)                                          from public, anon;
revoke all on function registrar_devolucion(bigint, jsonb, text, boolean)                    from public, anon;
revoke all on function registrar_compra(bigint, text, forma_pago_compra, date, jsonb, jsonb, metodo_pago) from public, anon;
revoke all on function registrar_pago_proveedor(bigint, numeric, metodo_pago)                from public, anon;
revoke all on function ajustar_inventario(bigint, integer, tipo_mov_inventario, text)        from public, anon;
revoke all on function resumen_dashboard()                                                   from public, anon;
revoke all on function ventas_por_empleado(date, date)                                       from public, anon;
revoke all on function registrar_actividad(text, text, text, jsonb)                          from public, anon, authenticated;

grant execute on function emitir_factura(bigint, metodo_pago, jsonb, numeric, text)            to authenticated;
grant execute on function anular_factura(bigint, text)                                          to authenticated;
grant execute on function registrar_devolucion(bigint, jsonb, text, boolean)                    to authenticated;
grant execute on function registrar_compra(bigint, text, forma_pago_compra, date, jsonb, jsonb, metodo_pago) to authenticated;
grant execute on function registrar_pago_proveedor(bigint, numeric, metodo_pago)                to authenticated;
grant execute on function ajustar_inventario(bigint, integer, tipo_mov_inventario, text)        to authenticated;
grant execute on function resumen_dashboard()                                                   to authenticated;
grant execute on function ventas_por_empleado(date, date)                                       to authenticated;

revoke all on productos_venta from anon;
grant select on productos_venta to authenticated;

-- ---------------------------------------------------------------------
-- 10. DATOS INICIALES
-- ---------------------------------------------------------------------
insert into tienda (id) values (1) on conflict do nothing;

insert into categorias (nombre) values
  ('Celulares'), ('Computadores'), ('Accesorios'), ('Televisores'), ('Gaming')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 11. PRIMER ADMINISTRADOR (ejecutar UNA vez, después de crear el usuario)
-- ---------------------------------------------------------------------
-- 1) En Supabase > Authentication > Users > Add user: correo + contraseña
--    (marca "Auto Confirm User").
-- 2) Copia el UUID del usuario y ejecuta (cambiando los datos):
--
--   insert into perfiles (id, nombre, correo, rol)
--   values ('PEGA-AQUI-EL-UUID', 'Marcela Herrera', 'tu-correo@ejemplo.com', 'admin');
