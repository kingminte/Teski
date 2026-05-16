-- ============================================================
-- Cuentas por pagar — proveedores, facturas y pagos
-- Aplicar en Supabase > SQL Editor
-- ============================================================

-- Tabla de proveedores
create table if not exists proveedores (
  id uuid primary key default gen_random_uuid(),
  rut text,
  nombre text not null,
  tipo text default 'empresa' check (tipo in ('empresa', 'persona')),
  giro text,
  direccion text,
  telefono text,
  email text,
  contacto text,
  activo boolean default true,
  created_at timestamptz default now()
);

-- Tabla de cuentas por pagar
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
  estado text default 'pendiente' check (estado in ('pendiente', 'parcial', 'pagada', 'anulada')),
  comentario text,
  created_at timestamptz default now()
);

-- Tabla de pagos de cuentas por pagar
create table if not exists pagos_cuenta (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid references cuentas_por_pagar(id) on delete cascade,
  monto integer not null,
  fecha_pago date not null default current_date,
  medio_pago text default 'cheque' check (medio_pago in ('cheque', 'transferencia', 'efectivo', 'otro')),
  chequera_detalle_id uuid references chequera_detalle(id) on delete set null,
  comprobante_path text,
  comentario text,
  created_at timestamptz default now()
);

-- Tabla de respaldos de cuentas por pagar
create table if not exists respaldos_cuenta (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid references cuentas_por_pagar(id) on delete cascade,
  nombre_archivo text not null,
  storage_path text not null,
  tipo text,
  created_at timestamptz default now()
);

-- RLS
alter table proveedores enable row level security;
drop policy if exists "auth proveedores" on proveedores;
create policy "auth proveedores" on proveedores for all using (auth.role() = 'authenticated');

alter table cuentas_por_pagar enable row level security;
drop policy if exists "auth cuentas_por_pagar" on cuentas_por_pagar;
create policy "auth cuentas_por_pagar" on cuentas_por_pagar for all using (auth.role() = 'authenticated');

alter table pagos_cuenta enable row level security;
drop policy if exists "auth pagos_cuenta" on pagos_cuenta;
create policy "auth pagos_cuenta" on pagos_cuenta for all using (auth.role() = 'authenticated');

alter table respaldos_cuenta enable row level security;
drop policy if exists "auth respaldos_cuenta" on respaldos_cuenta;
create policy "auth respaldos_cuenta" on respaldos_cuenta for all using (auth.role() = 'authenticated');

notify pgrst, 'reload schema';
