-- ============================================================
-- Plan de cuentas — categorías de ingresos y gastos del club
-- Aplicar en Supabase > SQL Editor
-- ============================================================

create table if not exists plan_cuentas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null check (tipo in ('ingreso', 'gasto')),
  descripcion text,
  activo boolean default true,
  created_at timestamptz default now()
);

insert into plan_cuentas (nombre, tipo, descripcion) values
  ('Cuota social', 'ingreso', 'Cuota anual de socios'),
  ('Incorporación', 'ingreso', 'Pago de incorporación de nuevos socios'),
  ('Arriendo instalaciones', 'ingreso', 'Arriendo de instalaciones del club'),
  ('Donaciones', 'ingreso', 'Donaciones recibidas'),
  ('Eventos y actividades', 'ingreso', 'Ingresos por eventos del club'),
  ('Multas', 'ingreso', 'Multas y penalidades cobradas'),
  ('Mantención refugio', 'gasto', 'Gastos de mantención del refugio'),
  ('Servicios básicos', 'gasto', 'Luz, agua, gas, internet'),
  ('Materiales', 'gasto', 'Compra de materiales y suministros'),
  ('Seguros', 'gasto', 'Pólizas de seguro'),
  ('Honorarios', 'gasto', 'Pagos por servicios profesionales'),
  ('Comisiones bancarias', 'gasto', 'Comisiones y cargos del banco'),
  ('Impuestos', 'gasto', 'Contribuciones e impuestos'),
  ('Otros gastos', 'gasto', 'Gastos no clasificados')
on conflict do nothing;

alter table plan_cuentas enable row level security;
drop policy if exists "auth plan_cuentas" on plan_cuentas;
create policy "auth plan_cuentas" on plan_cuentas for all using (auth.role() = 'authenticated');

notify pgrst, 'reload schema';
