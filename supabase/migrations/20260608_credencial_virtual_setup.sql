-- ============================================================
-- Módulo "Credencial Virtual" — credencial digital del socio
-- ============================================================
-- La credencial es DERIVADA del socio + sus beneficiarios + el estado
-- administrativo (socios.estado). NO se persiste como entidad propia.
-- El único cambio de esquema es un token público para la URL del QR.
--
-- El estado mostrado en la credencial sale DIRECTO de socios.estado
-- ('activo' → verde, 'pendiente' → ámbar, 'inactivo' → rojo). Es una
-- decisión administrativa del tesorero, no un cálculo de deuda.
--
-- Idempotente. NO corre solo: aplicar manualmente y verificar.
-- ============================================================

-- ── Token público para la URL del QR ────────────────────────
-- No se expone socios.id (UUID) en la URL pública: se usa un token
-- alfanumérico de 16 chars que puede rotarse si se filtra, sin tocar
-- el ID interno.
alter table socios
  add column if not exists credencial_token text unique;

-- ── Generador de token único (16 chars alfanuméricos) ───────
-- Verifica unicidad contra la tabla, reintentando ante colisión.
create or replace function gen_credencial_token() returns text
language plpgsql
as $$
declare
  v_chars  text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  v_result text;
  v_i      integer;
  v_existe boolean;
begin
  loop
    v_result := '';
    for v_i in 1..16 loop
      v_result := v_result || substr(v_chars, 1 + floor(random() * length(v_chars))::integer, 1);
    end loop;
    select exists(select 1 from socios where credencial_token = v_result) into v_existe;
    exit when not v_existe;
  end loop;
  return v_result;
end;
$$;

-- ── Backfill: token para socios existentes ──────────────────
-- Fila por fila para que gen_credencial_token() vea los tokens recién
-- asignados y garantice unicidad (evita colisión en el unique).
do $$
declare r record;
begin
  for r in select id from socios where credencial_token is null loop
    update socios set credencial_token = gen_credencial_token() where id = r.id;
  end loop;
end $$;

-- ── Trigger: token automático para socios nuevos ────────────
create or replace function trg_socios_credencial_token() returns trigger
language plpgsql
as $$
begin
  if new.credencial_token is null then
    new.credencial_token := gen_credencial_token();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_socios_credencial_token on socios;
create trigger trg_socios_credencial_token
  before insert on socios
  for each row execute function trg_socios_credencial_token();

-- ── Permisos por rol para la sección 'credencial' ───────────
-- admin/gestor: completo (pueden rotar token). lector/socio/andacor:
-- lectura (ven la credencial; andacor la usa para validar identidad).
insert into permisos_rol (rol, seccion, nivel) values
  ('admin',   'credencial', 'completo'),
  ('gestor',  'credencial', 'completo'),
  ('lector',  'credencial', 'lectura'),
  ('socio',   'credencial', 'lectura'),
  ('andacor', 'credencial', 'lectura')
on conflict (rol, seccion) do update set nivel = excluded.nivel;

notify pgrst, 'reload schema';
