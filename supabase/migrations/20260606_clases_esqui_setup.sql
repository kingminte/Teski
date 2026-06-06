-- ============================================================
-- Módulo "Clases de esquí" — Fase 1: esqueleto y catálogos
-- ============================================================
-- Crea el esquema completo del módulo (7 tablas + 2 campos en
-- socios/beneficiarios), RLS consistente con el resto del proyecto
-- (for all using (true)), y seeds iniciales (niveles, config singleton
-- y permisos_rol de las 5 secciones nuevas).
--
-- Tablas creadas en orden de dependencia (clases_grupos antes de
-- clases_solicitudes) para definir el FK grupo_id inline — sin
-- alter add constraint diferido. Migración re-ejecutable.
--
-- No hace backfill. La aplica el admin desde el SQL Editor.
-- ============================================================

-- Catálogo administrable de profesores
create table if not exists clases_profesores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true,
  comentario text,
  created_at timestamptz not null default now()
);

-- Catálogo administrable de niveles, con orden para mostrar
create table if not exists clases_niveles (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  orden integer not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Disponibilidad publicada por Andacor: días en que habrá clases
create table if not exists clases_disponibilidad (
  id uuid primary key default gen_random_uuid(),
  fecha date not null unique,
  notas text,
  created_at timestamptz not null default now(),
  created_by uuid references usuarios(id) on delete set null
);

-- Grupo armado por Andacor (la clase en sí). Va antes de
-- clases_solicitudes para poder referenciarlo inline.
create table if not exists clases_grupos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null,
  tipo text not null check (tipo in ('esqui','snowboard')),
  profesor_id uuid references clases_profesores(id) on delete set null,
  estado text not null default 'agendada' check (estado in ('agendada','realizada','cancelada')),
  comentario text,
  created_at timestamptz not null default now(),
  realizada_en timestamptz,
  realizada_por uuid references usuarios(id) on delete set null
);

-- Solicitud individual por participante (FK grupo_id inline)
create table if not exists clases_solicitudes (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid not null references socios(id) on delete cascade,
  participante_tipo text not null check (participante_tipo in ('socio','beneficiario')),
  participante_id uuid not null,
  fecha date not null,
  tipo text not null check (tipo in ('esqui','snowboard')),
  nivel_id uuid references clases_niveles(id) on delete set null,
  grupo_id uuid references clases_grupos(id) on delete set null,
  estado text not null default 'pendiente' check (estado in ('pendiente','agendada','cancelada','realizada','no_realizada')),
  created_at timestamptz not null default now()
);

-- Asistencia individual por participante por clase realizada
create table if not exists clases_asistencia (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references clases_grupos(id) on delete cascade,
  solicitud_id uuid not null references clases_solicitudes(id) on delete cascade,
  asistio boolean not null default true,
  comentario text,
  created_at timestamptz not null default now(),
  unique(grupo_id, solicitud_id)
);

-- Config singleton (1 fila) con tarifa y reglas
create table if not exists clases_config (
  id integer primary key default 1 check (id = 1),
  tarifa_hora_profesor integer not null default 0,
  horas_minimas_cancelacion integer not null default 2,
  updated_at timestamptz not null default now(),
  updated_by uuid references usuarios(id) on delete set null
);

insert into clases_config (id) values (1) on conflict do nothing;

-- Nivel de cada socio/beneficiario por disciplina
alter table socios
  add column if not exists nivel_esqui_id uuid references clases_niveles(id) on delete set null,
  add column if not exists nivel_snowboard_id uuid references clases_niveles(id) on delete set null;

alter table beneficiarios
  add column if not exists nivel_esqui_id uuid references clases_niveles(id) on delete set null,
  add column if not exists nivel_snowboard_id uuid references clases_niveles(id) on delete set null;

-- Seed inicial del catálogo de niveles (administrable luego)
insert into clases_niveles (nombre, orden) values
  ('Nunca esquió', 1),
  ('Principiante', 2),
  ('Intermedio básico', 3),
  ('Intermedio avanzado', 4),
  ('Avanzado', 5),
  ('Experto', 6)
on conflict do nothing;

-- ------------------------------------------------------------
-- RLS: mismo patrón que el resto del esquema (for all using (true),
-- a PUBLIC, que cubre el rol anon con el que se conecta el frontend).
-- ------------------------------------------------------------
do $$ declare t text;
begin
  for t in select unnest(array[
    'clases_profesores','clases_niveles','clases_disponibilidad',
    'clases_grupos','clases_solicitudes','clases_asistencia','clases_config'
  ]) loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon %s" on %I', t, t);
    execute format('create policy "anon %s" on %I for all using (true)', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- Permisos: 5 secciones nuevas × 5 roles. El editor de Usuarios hace
-- UPDATE (no upsert), así que las filas deben existir para todos los
-- pares (rol, seccion). Insert idempotente (where not exists).
-- ------------------------------------------------------------
insert into permisos_rol (rol, seccion, nivel)
select v.rol, v.seccion, v.nivel
from (values
  -- clases_catalogos: andacor + gestor + admin editan, lector lee
  ('admin','clases_catalogos','completo'),
  ('gestor','clases_catalogos','completo'),
  ('andacor','clases_catalogos','completo'),
  ('lector','clases_catalogos','lectura'),
  ('socio','clases_catalogos','ninguno'),
  -- clases_config: admin + gestor editan, lector lee, andacor no
  ('admin','clases_config','completo'),
  ('gestor','clases_config','completo'),
  ('andacor','clases_config','ninguno'),
  ('lector','clases_config','lectura'),
  ('socio','clases_config','ninguno'),
  -- clases_solicitar (Fase 2): solo socio
  ('admin','clases_solicitar','completo'),
  ('gestor','clases_solicitar','ninguno'),
  ('andacor','clases_solicitar','ninguno'),
  ('lector','clases_solicitar','ninguno'),
  ('socio','clases_solicitar','completo'),
  -- clases_gestion (Fase 2): andacor + admin
  ('admin','clases_gestion','completo'),
  ('gestor','clases_gestion','ninguno'),
  ('andacor','clases_gestion','completo'),
  ('lector','clases_gestion','ninguno'),
  ('socio','clases_gestion','ninguno'),
  -- clases_reporte (Fase 3): solo admin
  ('admin','clases_reporte','completo'),
  ('gestor','clases_reporte','ninguno'),
  ('andacor','clases_reporte','ninguno'),
  ('lector','clases_reporte','ninguno'),
  ('socio','clases_reporte','ninguno')
) as v(rol, seccion, nivel)
where not exists (
  select 1 from permisos_rol p where p.rol = v.rol and p.seccion = v.seccion
);

notify pgrst, 'reload schema';
