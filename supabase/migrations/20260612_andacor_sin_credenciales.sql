-- ============================================================
-- Quitar a Andacor el acceso a "Credenciales de socios"
-- ============================================================
-- Andacor valida escaneando el QR que el socio le muestra; no necesita
-- navegar la lista interna de socios (info administrativa del directorio).
-- No afecta admin/gestor/lector (siguen viendo /credenciales) ni la página
-- pública /credencial/:token (que Andacor sigue usando al escanear).
-- ============================================================
insert into permisos_rol (rol, seccion, nivel)
  values ('andacor', 'credencial', 'ninguno')
on conflict (rol, seccion) do update set nivel = 'ninguno';

notify pgrst, 'reload schema';
