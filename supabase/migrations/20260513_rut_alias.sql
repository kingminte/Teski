-- ============================================================
-- Aprendizaje de RUTs externos: asociar RUTs no registrados
-- en socios con un socio concreto, para que la próxima cartola
-- haga el calce automáticamente.
-- Aplicar en Supabase > SQL Editor
-- ============================================================

create table if not exists rut_alias (
  id uuid primary key default gen_random_uuid(),
  rut text not null,
  socio_id uuid references socios(id) on delete cascade,
  nombre_detectado text,
  created_at timestamptz default now(),
  unique(rut)
);

alter table rut_alias enable row level security;
drop policy if exists "auth rut_alias" on rut_alias;
create policy "auth rut_alias" on rut_alias for all using (auth.role() = 'authenticated');

notify pgrst, 'reload schema';
