-- ============================================================
-- Módulo "Beneficios" — acuerdos y convenios para socios
-- ============================================================
-- Sección informativa: el admin/gestor publica beneficios; los socios
-- ven solo los vigentes. Catálogo de categorías administrable.
-- Idempotente (create table if not exists, upsert de permisos).
-- ============================================================

create table if not exists beneficios_categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists beneficios (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  proveedor text not null,
  categoria_id uuid references beneficios_categorias(id) on delete set null,
  descuento_texto text not null,
  descripcion text,
  contacto text,
  url text,
  vigencia_desde date not null,
  vigencia_hasta date not null,
  activo boolean not null default true,
  archivado boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references usuarios(id) on delete set null,
  updated_at timestamptz,
  updated_by uuid references usuarios(id) on delete set null
);

-- RLS: mismo patrón del proyecto (for all using (true), a PUBLIC → rol anon).
alter table beneficios_categorias enable row level security;
drop policy if exists "anon beneficios_categorias" on beneficios_categorias;
create policy "anon beneficios_categorias" on beneficios_categorias for all using (true);

alter table beneficios enable row level security;
drop policy if exists "anon beneficios" on beneficios;
create policy "anon beneficios" on beneficios for all using (true);

-- Seed inicial de categorías (administrables luego desde la UI)
insert into beneficios_categorias (nombre, orden) values
  ('Restaurantes', 1),
  ('Equipamiento', 2),
  ('Hospedaje', 3),
  ('Servicios', 4)
on conflict do nothing;

-- Permisos por rol (permisos_rol tiene unique(rol, seccion))
insert into permisos_rol (rol, seccion, nivel) values
  ('admin',   'beneficios', 'completo'),
  ('gestor',  'beneficios', 'completo'),
  ('lector',  'beneficios', 'lectura'),
  ('socio',   'beneficios', 'lectura'),
  ('andacor', 'beneficios', 'ninguno')
on conflict (rol, seccion) do update set nivel = excluded.nivel;

notify pgrst, 'reload schema';
