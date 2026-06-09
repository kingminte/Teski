-- ============================================================
-- Módulo "Archivos Directorio" — repositorio interno de documentos
-- ============================================================
-- Documentos del directorio (contratos, actas, legales). Solo admin,
-- gestor y lector. Sin ciclo de publicación; estados vigente/archivado.
-- Tabla + categorías + RLS + bucket Storage + política + seeds + permisos,
-- todo por SQL (patrón cartolas/comunicaciones). Idempotente.
-- ============================================================

create table if not exists archivos_directorio_categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists archivos_directorio (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  resumen text,
  categoria_id uuid references archivos_directorio_categorias(id) on delete set null,
  fecha_termino date,                                        -- null = sin vencimiento
  estado text not null default 'vigente' check (estado in ('vigente','archivado')),
  archivo_path text,
  archivo_nombre text,
  archivo_tipo text,
  archivo_tamano integer,
  created_at timestamptz not null default now(),
  created_by uuid references usuarios(id) on delete set null,
  updated_at timestamptz,
  updated_by uuid references usuarios(id) on delete set null
);

-- RLS (patrón del proyecto: for all using (true) → rol anon)
alter table archivos_directorio_categorias enable row level security;
drop policy if exists "anon archivos_directorio_categorias" on archivos_directorio_categorias;
create policy "anon archivos_directorio_categorias" on archivos_directorio_categorias for all using (true);

alter table archivos_directorio enable row level security;
drop policy if exists "anon archivos_directorio" on archivos_directorio;
create policy "anon archivos_directorio" on archivos_directorio for all using (true);

-- Bucket de Storage privado, 100 MB, todos los tipos
insert into storage.buckets (id, name, public, file_size_limit)
  values ('archivos_directorio', 'archivos_directorio', false, 104857600)
  on conflict (id) do nothing;

-- Política sobre storage.objects (CRÍTICO: evita 403)
drop policy if exists "anon archivos_directorio storage" on storage.objects;
create policy "anon archivos_directorio storage" on storage.objects
  for all using (bucket_id = 'archivos_directorio') with check (bucket_id = 'archivos_directorio');

-- Seed de categorías
insert into archivos_directorio_categorias (nombre, orden) values
  ('Contratos', 1),
  ('Actas', 2),
  ('Legales', 3),
  ('Presupuestos', 4),
  ('Otros', 5)
on conflict do nothing;

-- Permisos por rol
insert into permisos_rol (rol, seccion, nivel) values
  ('admin',   'archivos_directorio', 'completo'),
  ('gestor',  'archivos_directorio', 'completo'),
  ('lector',  'archivos_directorio', 'lectura'),
  ('socio',   'archivos_directorio', 'ninguno'),
  ('andacor', 'archivos_directorio', 'ninguno')
on conflict (rol, seccion) do update set nivel = excluded.nivel;

notify pgrst, 'reload schema';
