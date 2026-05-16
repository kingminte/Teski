-- ============================================================
-- Flag para forzar cambio de clave en primer login o tras reset
-- Aplicar en Supabase > SQL Editor
-- ============================================================

alter table usuarios add column if not exists debe_cambiar_clave boolean default true;

-- Usuarios que ya se loguearon antes: no forzar
update usuarios set debe_cambiar_clave = false where ultimo_acceso is not null;
-- Usuarios que nunca se loguearon: forzar
update usuarios set debe_cambiar_clave = true where ultimo_acceso is null;

notify pgrst, 'reload schema';
