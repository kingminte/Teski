-- ============================================================
-- Sistema de usuarios y permisos por rol
-- Aplicar en Supabase > SQL Editor
-- ============================================================

create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  nombre text not null,
  email text,
  password_hash text not null,
  rol text not null default 'socio' check (rol in ('admin', 'gestor', 'lector', 'andacor', 'socio')),
  socio_id uuid references socios(id) on delete set null,
  activo boolean default true,
  ultimo_acceso timestamptz,
  created_at timestamptz default now()
);

create table if not exists permisos_rol (
  id uuid primary key default gen_random_uuid(),
  rol text not null,
  seccion text not null,
  nivel text not null default 'ninguno' check (nivel in ('completo', 'lectura', 'ninguno')),
  unique(rol, seccion)
);

insert into permisos_rol (rol, seccion, nivel) values
  ('admin', 'dashboard', 'completo'),
  ('admin', 'socios', 'completo'),
  ('admin', 'beneficiarios', 'completo'),
  ('admin', 'cuotas', 'completo'),
  ('admin', 'cartola', 'completo'),
  ('admin', 'cheques', 'completo'),
  ('admin', 'chequera', 'completo'),
  ('admin', 'cuentas_por_pagar', 'completo'),
  ('admin', 'cobranza', 'completo'),
  ('admin', 'configuracion', 'completo'),
  ('admin', 'reporteria', 'completo'),
  ('admin', 'usuarios', 'completo'),
  ('gestor', 'dashboard', 'completo'),
  ('gestor', 'socios', 'completo'),
  ('gestor', 'beneficiarios', 'completo'),
  ('gestor', 'cuotas', 'completo'),
  ('gestor', 'cartola', 'completo'),
  ('gestor', 'cheques', 'completo'),
  ('gestor', 'chequera', 'completo'),
  ('gestor', 'cuentas_por_pagar', 'completo'),
  ('gestor', 'cobranza', 'completo'),
  ('gestor', 'configuracion', 'ninguno'),
  ('gestor', 'reporteria', 'completo'),
  ('gestor', 'usuarios', 'ninguno'),
  ('lector', 'dashboard', 'lectura'),
  ('lector', 'socios', 'lectura'),
  ('lector', 'beneficiarios', 'lectura'),
  ('lector', 'cuotas', 'lectura'),
  ('lector', 'cartola', 'lectura'),
  ('lector', 'cheques', 'lectura'),
  ('lector', 'chequera', 'lectura'),
  ('lector', 'cuentas_por_pagar', 'lectura'),
  ('lector', 'cobranza', 'ninguno'),
  ('lector', 'configuracion', 'ninguno'),
  ('lector', 'reporteria', 'lectura'),
  ('lector', 'usuarios', 'ninguno'),
  ('andacor', 'dashboard', 'lectura'),
  ('andacor', 'socios', 'ninguno'),
  ('andacor', 'beneficiarios', 'ninguno'),
  ('andacor', 'cuotas', 'lectura'),
  ('andacor', 'cartola', 'lectura'),
  ('andacor', 'cheques', 'lectura'),
  ('andacor', 'chequera', 'lectura'),
  ('andacor', 'cuentas_por_pagar', 'lectura'),
  ('andacor', 'cobranza', 'ninguno'),
  ('andacor', 'configuracion', 'ninguno'),
  ('andacor', 'reporteria', 'lectura'),
  ('andacor', 'usuarios', 'ninguno'),
  ('socio', 'dashboard', 'ninguno'),
  ('socio', 'socios', 'ninguno'),
  ('socio', 'beneficiarios', 'lectura'),
  ('socio', 'cuotas', 'lectura'),
  ('socio', 'cartola', 'ninguno'),
  ('socio', 'cheques', 'ninguno'),
  ('socio', 'chequera', 'ninguno'),
  ('socio', 'cuentas_por_pagar', 'ninguno'),
  ('socio', 'cobranza', 'ninguno'),
  ('socio', 'configuracion', 'ninguno'),
  ('socio', 'reporteria', 'ninguno'),
  ('socio', 'usuarios', 'ninguno')
on conflict (rol, seccion) do nothing;

-- Usuario admin inicial — password: admin123 (SHA-256)
insert into usuarios (username, nombre, email, password_hash, rol) values
  ('admin', 'Michael King', 'kingminte@gmail.com', encode(sha256('admin123'), 'hex'), 'admin')
on conflict (username) do nothing;

alter table usuarios enable row level security;
drop policy if exists "auth usuarios" on usuarios;
create policy "auth usuarios" on usuarios for all using (auth.role() = 'authenticated');

alter table permisos_rol enable row level security;
drop policy if exists "auth permisos_rol" on permisos_rol;
create policy "auth permisos_rol" on permisos_rol for all using (auth.role() = 'authenticated');

notify pgrst, 'reload schema';
