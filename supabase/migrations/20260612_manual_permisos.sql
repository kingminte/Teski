-- ============================================================
-- Manual del usuario — permisos de la sección "manual"
-- ============================================================
-- Solo lectura para todos los roles (no hay nada que editar).
-- ============================================================
insert into permisos_rol (rol, seccion, nivel) values
  ('admin',   'manual', 'lectura'),
  ('gestor',  'manual', 'lectura'),
  ('lector',  'manual', 'lectura'),
  ('socio',   'manual', 'lectura'),
  ('andacor', 'manual', 'lectura')
on conflict (rol, seccion) do update set nivel = excluded.nivel;

notify pgrst, 'reload schema';
