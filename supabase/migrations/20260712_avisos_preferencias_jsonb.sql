-- ============================================================
-- Avisos por email — Preferencias granulares del socio (jsonb)
-- ============================================================
-- Migra el modelo de preferencias de un booleano único
-- (socios.recibe_avisos_escuela) a un jsonb por tipo de aviso.
--
-- Estructura de socios.preferencias_avisos:
--   general     → override maestro. Si es false, NO llega nada aunque los
--                 específicos estén en true. Los específicos se conservan
--                 (se recuerdan si el socio reactiva 'general').
--   dia_abierto → aviso de nuevas fechas habilitadas.
--   horario     → confirmación de horario de clase.
--
-- TRANSICIÓN SEGURA: agrega el jsonb nuevo SIN borrar recibe_avisos_escuela
-- (el perfil del socio y el helper de filtrado todavía lo leen). La columna
-- vieja se elimina en una migración POSTERIOR, cuando las pantallas ya usen
-- preferencias_avisos.
--
-- Idempotente. NO corre solo: aplicar manualmente en el SQL Editor.
-- ============================================================

-- 1. Columna jsonb nueva (el not null default backfillea todo a "todo activo").
alter table socios
  add column if not exists preferencias_avisos jsonb not null
  default '{"general": true, "dia_abierto": true, "horario": true}'::jsonb;

-- 2. Sincronizar 'general' con el valor REAL del campo viejo.
--    OJO: el default del paso 1 dejó a TODOS con general=true; este update
--    corrige a los socios que tuvieran recibe_avisos_escuela = false.
--    Condición idempotente: solo toca filas cuyo 'general' aún no coincide con
--    recibe_avisos_escuela (null/'{}'/mismatch → se pueblan; ya correctos → no-op).
update socios
set preferencias_avisos = jsonb_build_object(
      'general', recibe_avisos_escuela,
      'dia_abierto', true,
      'horario', true)
where (preferencias_avisos->>'general')::boolean is distinct from recibe_avisos_escuela;

-- 3. NO se borra socios.recibe_avisos_escuela todavía (migración posterior).

notify pgrst, 'reload schema';
