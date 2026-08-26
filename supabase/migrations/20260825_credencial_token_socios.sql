-- ============================================================
-- Credencial Virtual — QR estable por socio (reemplaza el rotativo)
-- ============================================================
-- El QR ya no rota: codifica /credencial-publica?t={credencial_token}.
-- Los socios muestran un pantallazo en el centro de esquí (sin señal);
-- quien valida SÍ tiene internet, y la página pública consulta el estado
-- ACTUAL del socio al escanear. La seguridad vive ahí, no en la rotación.
--
-- El token se regenera desde la vista de Credenciales (rol admin), lo que
-- invalida el QR anterior y sus pantallazos.
--
-- Idempotente. NO corre solo: aplicar manualmente y verificar.
-- ============================================================

-- ── Token estable por socio (YA APLICADO por el usuario) ────
alter table socios
  add column if not exists credencial_token uuid not null default gen_random_uuid();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'socios'::regclass and conname = 'socios_credencial_token_key'
  ) then
    alter table socios add constraint socios_credencial_token_key unique (credencial_token);
  end if;
end $$;

-- ── Limpieza del esquema anterior (tokens efímeros de 60s) ──
-- Ya no lo usa nadie en el front: el QR rotativo del admin y el token
-- 'infinity' de "Mi Credencial" quedaron unificados en socios.credencial_token.
-- OJO: el drop de la tabla borra los tokens antiguos de forma definitiva.
drop function if exists validar_token_credencial(text);
drop function if exists crear_token_credencial(uuid);
drop function if exists obtener_token_credencial(uuid);
drop function if exists gen_credencial_token_efimero();
drop table if exists credencial_tokens;

notify pgrst, 'reload schema';
