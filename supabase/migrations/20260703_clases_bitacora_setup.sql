-- ============================================================
-- Clases de esquí — Bitácora de feedback por alumno
-- ============================================================
-- Registro de feedback por alumno, escrito por el operador (admin/andacor)
-- y visible para el padre (rol socio) solo respecto de SU familia.
--
-- Modelo de alumno POLIMÓRFICO igual que clases_solicitudes
-- (participante_tipo + participante_id, sin FK rígida) para servir a
-- beneficiarios (menores) y a socios adultos. Se denormaliza socio_id
-- (clave de familia, con FK) para filtrar por familia sin fugas y limpiar
-- en cascada si se borra el socio.
--
-- Decisiones (revisadas antes de crear):
--   · comentario = cuerpo del feedback (nombre consistente con el módulo).
--   · grupo_id OPCIONAL (on delete set null): el feedback sobrevive si el
--     grupo se borra/revierte/divide; fecha propia, no derivada del grupo.
--   · autor real = created_by/updated_by (usuario). profesor_id = catálogo,
--     solo para mostrar quién dictó (los profesores no tienen cuenta).
--   · "editar lo suyo" se resuelve en UI por created_by.
--   · RLS permisiva (using true) como el resto del sistema: control solo-UI.
--     ⚠️ Son datos de menores; el aislamiento por familia es a nivel de query
--        (socio_id) + permisos_rol en UI, NO RLS real. Decisión explícita.
--
-- Idempotente. NO corre solo: aplicar manualmente en el SQL Editor.
-- ============================================================

create table if not exists clases_bitacora (
  id                uuid primary key default gen_random_uuid(),

  -- Alumno: mismo modelo polimórfico que clases_solicitudes (sin FK rígida)
  participante_tipo text not null check (participante_tipo in ('socio','beneficiario')),
  participante_id   uuid not null,               -- socios.id o beneficiarios.id según tipo

  -- Clave de familia (denormalizada, con FK): padre/dueño. Para beneficiario
  -- = beneficiarios.socio_id; para socio adulto = su propio socios.id.
  socio_id          uuid not null references socios(id) on delete cascade,

  -- Contexto opcional de la clase
  grupo_id          uuid references clases_grupos(id) on delete set null,
  profesor_id       uuid references clases_profesores(id) on delete set null,

  -- Contenido
  comentario        text not null,
  fecha             date not null,

  -- Autoría real = usuario admin/andacor que escribió/editó
  created_by        uuid references usuarios(id) on delete set null,
  updated_by        uuid references usuarios(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_clases_bitacora_socio       on clases_bitacora(socio_id);
create index if not exists idx_clases_bitacora_participante on clases_bitacora(participante_tipo, participante_id);
create index if not exists idx_clases_bitacora_grupo        on clases_bitacora(grupo_id);

-- "Editado" automático: reutiliza la función trigger genérica ya existente
-- (la misma que usa socios). Se incluye create-or-replace por idempotencia.
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists clases_bitacora_updated_at on clases_bitacora;
create trigger clases_bitacora_updated_at
  before update on clases_bitacora
  for each row execute function update_updated_at();

-- RLS consistente con el módulo (control solo-UI): abierta a PUBLIC.
alter table clases_bitacora enable row level security;
drop policy if exists "anon clases_bitacora" on clases_bitacora;
create policy "anon clases_bitacora" on clases_bitacora for all using (true);

-- Permisos por rol (sección nueva 'clases_bitacora'), patrón idempotente
-- (insert where not exists), consistente con el editor de Usuarios (UPDATE).
--   admin/andacor: completo (escriben).  socio: lectura (ve su familia).
insert into permisos_rol (rol, seccion, nivel)
select v.rol, v.seccion, v.nivel
from (values
  ('admin',   'clases_bitacora', 'completo'),
  ('andacor', 'clases_bitacora', 'completo'),
  ('gestor',  'clases_bitacora', 'ninguno'),
  ('lector',  'clases_bitacora', 'ninguno'),
  ('socio',   'clases_bitacora', 'lectura')
) as v(rol, seccion, nivel)
where not exists (
  select 1 from permisos_rol p where p.rol = v.rol and p.seccion = v.seccion
);

notify pgrst, 'reload schema';
