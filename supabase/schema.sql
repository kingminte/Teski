-- ============================================================
-- TESKI CLUB — Esquema de base de datos
-- Ejecutar en Supabase > SQL Editor
-- ============================================================

-- Socios
create table socios (
  id uuid primary key default gen_random_uuid(),
  numero_socio text unique not null,
  nombre text not null,
  apellido text not null,
  rut text unique not null,
  email text,
  telefono text,
  direccion text,
  fecha_ingreso date not null default current_date,
  estado text not null default 'activo' check (estado in ('activo','pendiente','inactivo')),
  banco text,
  valor_cuota integer not null default 12000,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Beneficiarios
create table beneficiarios (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid not null references socios(id) on delete cascade,
  nombre text not null,
  apellido text not null,
  rut text not null,
  fecha_nacimiento date,
  relacion text not null check (relacion in ('conyuge','hijo','padre','madre','hermano','otro')),
  estado text not null default 'vigente' check (estado in ('vigente','inactivo')),
  observaciones text,
  created_at timestamptz default now()
);

-- Cartolas cargadas
create table cartolas (
  id uuid primary key default gen_random_uuid(),
  nombre_archivo text not null,
  periodo text not null,
  banco text,
  total_movimientos integer default 0,
  storage_path text,
  created_at timestamptz default now()
);

-- Movimientos bancarios
create table movimientos (
  id uuid primary key default gen_random_uuid(),
  cartola_id uuid references cartolas(id) on delete cascade,
  fecha date not null,
  descripcion text not null,
  monto integer not null,
  saldo integer,
  tipo text not null check (tipo in ('abono','cargo')),
  socio_id uuid references socios(id) on delete set null,
  estado text not null default 'pendiente' check (estado in ('pendiente','conciliado','gasto','ignorado')),
  created_at timestamptz default now()
);

-- Cuotas
create table cuotas (
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

-- Auto-actualizar updated_at en socios
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger socios_updated_at
  before update on socios
  for each row execute function update_updated_at();

-- ============================================================
-- Vistas útiles
-- ============================================================

-- Resumen por socio
create view vista_socios as
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

-- ============================================================
-- Row Level Security (acceso solo autenticado)
-- ============================================================
alter table socios enable row level security;
alter table beneficiarios enable row level security;
alter table cartolas enable row level security;
alter table movimientos enable row level security;
alter table cuotas enable row level security;

create policy "autenticados pueden ver socios" on socios for all using (auth.role() = 'authenticated');
create policy "autenticados pueden ver beneficiarios" on beneficiarios for all using (auth.role() = 'authenticated');
create policy "autenticados pueden ver cartolas" on cartolas for all using (auth.role() = 'authenticated');
create policy "autenticados pueden ver movimientos" on movimientos for all using (auth.role() = 'authenticated');
create policy "autenticados pueden ver cuotas" on cuotas for all using (auth.role() = 'authenticated');

-- Bucket para archivos de cartola
insert into storage.buckets (id, name, public) values ('cartolas', 'cartolas', false);
create policy "autenticados pueden subir cartolas" on storage.objects
  for insert with check (bucket_id = 'cartolas' and auth.role() = 'authenticated');
create policy "autenticados pueden leer cartolas" on storage.objects
  for select using (bucket_id = 'cartolas' and auth.role() = 'authenticated');
