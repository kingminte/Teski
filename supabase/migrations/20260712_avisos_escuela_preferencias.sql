-- ============================================================
-- Avisos por email — Segmentación + consentimiento (Escuela de esquí)
-- ============================================================
-- Dos piezas de datos para los avisos de la Escuela:
--   1) Consentimiento por socio (opt-out): recibe_avisos_escuela.
--   2) Segmentación por estado (config editable por admin): qué estados de
--      socio reciben los avisos de la Escuela.
--
-- Estados reales en socios.estado (verificado): 'activo', 'pendiente', 'inactivo'.
-- Semilla: 'activo,pendiente' (inactivo excluido). Nota: por el código, solo
-- 'activo' puede inscribirse; 'pendiente' recibe el aviso como recordatorio para
-- regularizar. Editable desde "Avisos por email".
--
-- Idempotente (add column if not exists / on conflict do nothing).
-- NO corre solo: aplicar manualmente en el SQL Editor.
-- ============================================================

-- 1. Consentimiento por socio (opt-out: todos arrancan recibiendo).
alter table socios
  add column if not exists recibe_avisos_escuela boolean not null default true;

-- 2. Estados que reciben avisos de la Escuela (config editable por admin).
insert into config_club (clave, valor, descripcion) values
  (
    'avisos_escuela_estados',
    'activo,pendiente',
    'Estados de socio que reciben avisos de la Escuela de esquí (separados por coma). El admin lo configura desde Avisos por email.'
  )
on conflict (clave) do nothing;
