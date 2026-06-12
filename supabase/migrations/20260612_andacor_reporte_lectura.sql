-- ============================================================
-- Andacor: acceso de LECTURA al reporte mensual (sin valores económicos)
-- ============================================================
-- Los montos se ocultan a nivel UI en ReporteClases.jsx. Acá solo se
-- habilita el acceso de lectura a la sección.
-- ============================================================
insert into permisos_rol (rol, seccion, nivel)
  values ('andacor', 'clases_reporte', 'lectura')
on conflict (rol, seccion) do update set nivel = 'lectura';

notify pgrst, 'reload schema';
