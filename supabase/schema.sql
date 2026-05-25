-- ============================================================
-- TESKI CLUB — Esquema completo de base de datos
-- Ejecutar en Supabase > SQL Editor para una instalación limpia.
-- Las migraciones incrementales viven en supabase/migrations/.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Socios y beneficiarios
-- ────────────────────────────────────────────────────────────
create table if not exists socios (
  id uuid primary key default gen_random_uuid(),
  numero_socio text unique not null,
  nombre text not null,
  apellido text not null,
  rut text unique not null,
  email text,
  telefono text,
  direccion text,
  fecha_ingreso date not null default current_date,
  fecha_inactividad date,
  estado text not null default 'activo' check (estado in ('activo','pendiente','inactivo')),
  banco text,
  valor_cuota integer not null default 12000,
  comentarios text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists beneficiarios (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid not null references socios(id) on delete cascade,
  nombre text not null,
  apellido text not null,
  rut text not null,
  fecha_nacimiento date,
  relacion text not null check (relacion in ('conyuge','hijo','padre','madre','hermano','otro')),
  estado text not null default 'vigente' check (estado in ('vigente','inactivo')),
  estado_previo text,
  observaciones text,
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- Cartolas y movimientos bancarios
-- ────────────────────────────────────────────────────────────
create table if not exists cartolas (
  id uuid primary key default gen_random_uuid(),
  nombre_archivo text not null,
  periodo text not null,
  mes integer,
  anio integer,
  banco text,
  tipo text default 'cartola',
  total_movimientos integer default 0,
  saldo_inicial integer default 0,
  saldo_final integer default 0,
  total_abonos integer default 0,
  total_cargos integer default 0,
  storage_path text,
  created_at timestamptz default now()
);

create table if not exists movimientos (
  id uuid primary key default gen_random_uuid(),
  cartola_id uuid references cartolas(id) on delete cascade,
  fecha date not null,
  descripcion text not null,
  monto integer not null,
  saldo integer,
  sucursal text,
  n_documento text,
  tipo text not null check (tipo in ('abono','cargo')),
  socio_id uuid references socios(id) on delete set null,
  chequera_detalle_id uuid,
  rut_detectado text,
  nombre_detectado text,
  monto_conciliado integer,
  monto_pendiente integer,
  estado text not null default 'pendiente' check (estado in ('pendiente','conciliado','gasto','ignorado')),
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- Cuotas y períodos
-- ────────────────────────────────────────────────────────────
create table if not exists periodos_cuota (
  id uuid primary key default gen_random_uuid(),
  anio integer not null,
  monto integer not null,
  descripcion text,
  created_at timestamptz default now()
);

create table if not exists pagos_cuota (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid references socios(id) on delete cascade,
  periodo_id uuid references periodos_cuota(id) on delete set null,
  monto integer not null,
  fecha_pago date not null default current_date,
  forma_pago text default 'transferencia',
  cheque_id uuid,
  movimiento_id uuid references movimientos(id) on delete set null,
  concepto text,
  comentario text,
  created_at timestamptz default now()
);

-- Legacy: tabla original "cuotas". Se mantiene por compatibilidad de vista_socios.
create table if not exists cuotas (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid not null references socios(id) on delete cascade,
  periodo text not null,
  monto integer not null,
  fecha_vencimiento date,
  fecha_pago date,
  movimiento_id uuid references movimientos(id) on delete set null,
  estado text not null default 'pendiente' check (estado in ('pagado','pendiente','mora')),
  created_at timestamptz default now(),
  unique(socio_id, periodo)
);

-- ────────────────────────────────────────────────────────────
-- Cheques recibidos y chequera (cheques emitidos)
-- ────────────────────────────────────────────────────────────
create table if not exists cheques (
  id uuid primary key default gen_random_uuid(),
  numero text not null,
  socio_id uuid references socios(id) on delete set null,
  emisor text,
  banco_emisor text,
  banco_destino text,
  monto integer not null,
  concepto text,
  concepto_descripcion text,
  fecha_deposito date,
  estado text default 'por_depositar' check (estado in ('por_depositar','depositado','anulado')),
  movimiento_id uuid references movimientos(id) on delete set null,
  comentario text,
  created_at timestamptz default now()
);

create table if not exists chequeras (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  banco text default 'Banco Estado',
  folio_inicial integer not null,
  folio_final integer not null,
  estado text default 'activa' check (estado in ('activa','agotada','anulada')),
  created_at timestamptz default now()
);

create table if not exists chequera_detalle (
  id uuid primary key default gen_random_uuid(),
  chequera_id uuid references chequeras(id) on delete cascade,
  folio integer not null,
  fecha date not null default current_date,
  beneficiario text,
  concepto text,
  monto integer,
  estado text default 'emitido' check (estado in ('emitido','cobrado','anulado')),
  storage_path text,
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- Plan de cuentas y otros ingresos
-- ────────────────────────────────────────────────────────────
create table if not exists plan_cuentas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null check (tipo in ('ingreso','gasto')),
  descripcion text,
  activo boolean default true,
  created_at timestamptz default now()
);

create table if not exists otros_ingresos (
  id uuid primary key default gen_random_uuid(),
  movimiento_id uuid references movimientos(id) on delete set null,
  cartola_id uuid references cartolas(id) on delete set null,
  fecha date,
  descripcion text,
  concepto text,
  monto integer not null,
  origen text default 'cartola',
  storage_path text,
  nombre_archivo text,
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- Proveedores, cuentas por pagar y pagos
-- ────────────────────────────────────────────────────────────
create table if not exists proveedores (
  id uuid primary key default gen_random_uuid(),
  rut text,
  nombre text not null,
  tipo text default 'empresa' check (tipo in ('empresa','persona')),
  giro text,
  direccion text,
  telefono text,
  email text,
  contacto text,
  activo boolean default true,
  created_at timestamptz default now()
);

create table if not exists cuentas_por_pagar (
  id uuid primary key default gen_random_uuid(),
  numero serial,
  proveedor_id uuid references proveedores(id) on delete set null,
  concepto text not null,
  descripcion text,
  categoria text,
  monto_total integer not null,
  monto_pagado integer default 0,
  fecha_emision date not null default current_date,
  fecha_vencimiento date,
  estado text default 'pendiente' check (estado in ('pendiente','parcial','pagada','anulada')),
  comentario text,
  created_at timestamptz default now()
);

create table if not exists pagos_cuenta (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid references cuentas_por_pagar(id) on delete cascade,
  monto integer not null,
  fecha_pago date not null default current_date,
  medio_pago text default 'cheque' check (medio_pago in ('cheque','transferencia','efectivo','otro')),
  chequera_detalle_id uuid references chequera_detalle(id) on delete set null,
  comprobante_path text,
  comentario text,
  estado text default 'pagado',
  created_at timestamptz default now()
);

create table if not exists respaldos_cuenta (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid references cuentas_por_pagar(id) on delete cascade,
  nombre_archivo text not null,
  storage_path text not null,
  tipo text,
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- Configuración del club y cobranza
-- ────────────────────────────────────────────────────────────
create table if not exists config_club (
  id uuid primary key default gen_random_uuid(),
  clave text unique not null,
  valor text not null,
  descripcion text
);

create table if not exists envios_cobranza (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid references socios(id) on delete set null,
  periodo_id uuid references periodos_cuota(id),
  tipo text not null check (tipo in ('masivo','individual')),
  email_destino text,
  monto_pendiente integer,
  estado text default 'enviado' check (estado in ('enviado','error','simulado')),
  error_mensaje text,
  created_at timestamptz default now()
);

create table if not exists bancos (
  id uuid primary key default gen_random_uuid(),
  nombre text unique not null,
  descripcion text,
  activo boolean default true,
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- Aprendizaje de RUTs externos (alias)
-- ────────────────────────────────────────────────────────────
create table if not exists rut_alias (
  id uuid primary key default gen_random_uuid(),
  rut text not null unique,
  socio_id uuid references socios(id) on delete cascade,
  nombre_detectado text,
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- Usuarios y permisos por rol
-- ────────────────────────────────────────────────────────────
create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  nombre text not null,
  email text,
  password_hash text not null,
  rol text not null default 'socio' check (rol in ('admin','gestor','lector','andacor','socio')),
  socio_id uuid references socios(id) on delete set null,
  activo boolean default true,
  ultimo_acceso timestamptz,
  debe_cambiar_clave boolean default true,
  created_at timestamptz default now()
);

create table if not exists permisos_rol (
  id uuid primary key default gen_random_uuid(),
  rol text not null,
  seccion text not null,
  nivel text not null default 'ninguno' check (nivel in ('completo','lectura','ninguno')),
  unique(rol, seccion)
);

-- ────────────────────────────────────────────────────────────
-- Vistas
-- ────────────────────────────────────────────────────────────
create or replace view vista_socios as
select
  s.*,
  s.nombre || ' ' || s.apellido as nombre_completo,
  count(distinct b.id) as total_beneficiarios,
  count(distinct case when c.estado = 'pendiente' then c.id end) as cuotas_pendientes,
  count(distinct case when c.estado = 'pagado' then c.id end) as cuotas_pagadas
from socios s
left join beneficiarios b on b.socio_id = s.id and b.estado = 'vigente'
left join cuotas c on c.socio_id = s.id
group by s.id;

-- ────────────────────────────────────────────────────────────
-- Trigger updated_at
-- ────────────────────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists socios_updated_at on socios;
create trigger socios_updated_at
  before update on socios
  for each row execute function update_updated_at();

-- ────────────────────────────────────────────────────────────
-- Storage bucket
-- ────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('cartolas','cartolas', false)
  on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────
-- Row Level Security
-- ────────────────────────────────────────────────────────────
-- NOTA: la app actualmente abre RLS a `using (true)` para permitir
-- el login custom (que valida contra la tabla `usuarios` sin sesión
-- de Supabase Auth). Si migrás a Supabase Auth real, reemplazá las
-- políticas por `using (auth.role() = 'authenticated')`.
-- ────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  for t in select unnest(array[
    'socios','beneficiarios','cartolas','movimientos','cuotas',
    'periodos_cuota','pagos_cuota','cheques','chequeras','chequera_detalle',
    'plan_cuentas','otros_ingresos','proveedores','cuentas_por_pagar',
    'pagos_cuenta','respaldos_cuenta','config_club','envios_cobranza',
    'bancos','rut_alias','usuarios','permisos_rol'
  ]) loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon %s" on %I', t, t);
    execute format('create policy "anon %s" on %I for all using (true)', t, t);
  end loop;
end $$;

-- Storage policies (también abiertas a anon — mismo motivo)
drop policy if exists "anon cartolas storage" on storage.objects;
create policy "anon cartolas storage" on storage.objects
  for all using (bucket_id = 'cartolas') with check (bucket_id = 'cartolas');

notify pgrst, 'reload schema';
