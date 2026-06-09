-- ============================================================
-- Módulo "Comunicaciones" — documentos de la directiva para socios
-- ============================================================
-- Tabla + RLS + permisos + bucket de Storage + política sobre
-- storage.objects, todo por SQL (mismo patrón que el bucket cartolas
-- en schema.sql). Reproducible en reset/restore.
-- Idempotente (if not exists / on conflict / drop policy if exists).
-- ============================================================

create table if not exists comunicaciones (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  resumen text,
  emisor text,
  fecha_publicacion date not null default current_date,
  estado text not null default 'borrador' check (estado in ('borrador','publicada','archivada')),
  archivo_path text,
  archivo_nombre text,
  archivo_tipo text,
  archivo_tamano integer,
  created_at timestamptz not null default now(),
  created_by uuid references usuarios(id) on delete set null,
  updated_at timestamptz,
  updated_by uuid references usuarios(id) on delete set null
);

-- RLS de la tabla (patrón del proyecto: for all using (true) → rol anon)
alter table comunicaciones enable row level security;
drop policy if exists "anon comunicaciones" on comunicaciones;
create policy "anon comunicaciones" on comunicaciones for all using (true);

-- Permisos por rol (permisos_rol tiene unique(rol, seccion))
insert into permisos_rol (rol, seccion, nivel) values
  ('admin',   'comunicaciones', 'completo'),
  ('gestor',  'comunicaciones', 'completo'),
  ('lector',  'comunicaciones', 'lectura'),
  ('socio',   'comunicaciones', 'lectura'),
  ('andacor', 'comunicaciones', 'ninguno')
on conflict (rol, seccion) do update set nivel = excluded.nivel;

-- ------------------------------------------------------------
-- Storage: bucket privado + política (mismo patrón que cartolas).
-- file_size_limit = 100 MB (104857600 bytes). Sin allowed_mime_types
-- (acepta todos los tipos).
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
  values ('comunicaciones', 'comunicaciones', false, 104857600)
  on conflict (id) do nothing;

drop policy if exists "anon comunicaciones storage" on storage.objects;
create policy "anon comunicaciones storage" on storage.objects
  for all using (bucket_id = 'comunicaciones') with check (bucket_id = 'comunicaciones');

notify pgrst, 'reload schema';
