-- ============================================================
-- Clases de esquí — Fase 2: RPC de creación de solicitudes
-- ============================================================
-- crear_solicitudes_clase crea N solicitudes (una por participante) en
-- una sola transacción: valida que no exista una solicitud activa para
-- el mismo participante+fecha+tipo, inserta, y sincroniza el nivel del
-- perfil del participante (socios/beneficiarios) para la disciplina
-- elegida. Si algún paso falla, revierte todo.
--
-- p_participantes: jsonb array de objetos
--   [{ "tipo": "socio"|"beneficiario", "id": "<uuid>", "nivel_id": "<uuid>|null" }, ...]
--
-- Idempotente: create or replace function.
-- ============================================================
create or replace function crear_solicitudes_clase(
  p_socio_id      uuid,
  p_fecha         date,
  p_tipo          text,
  p_participantes jsonb
) returns void
language plpgsql
as $$
declare
  v_elem  jsonb;
  v_tipo  text;
  v_id    uuid;
  v_nivel uuid;
begin
  if p_tipo not in ('esqui','snowboard') then
    raise exception 'tipo de clase inválido: %', p_tipo;
  end if;
  if p_participantes is null or jsonb_array_length(p_participantes) = 0 then
    raise exception 'debe haber al menos un participante';
  end if;

  for v_elem in select * from jsonb_array_elements(p_participantes)
  loop
    v_tipo  := v_elem->>'tipo';
    v_id    := (v_elem->>'id')::uuid;
    v_nivel := nullif(v_elem->>'nivel_id', '')::uuid;

    if v_tipo not in ('socio','beneficiario') then
      raise exception 'participante_tipo inválido: %', v_tipo;
    end if;

    -- Un participante no puede tener 2 solicitudes activas para la misma
    -- fecha + mismo tipo. (Red de seguridad atómica; el frontend además
    -- pre-chequea para mostrar un mensaje con nombre.)
    if exists (
      select 1 from clases_solicitudes
      where participante_id = v_id
        and fecha = p_fecha
        and tipo = p_tipo
        and estado in ('pendiente','agendada')
    ) then
      raise exception 'solicitud_duplicada:%', v_id;
    end if;

    insert into clases_solicitudes (
      socio_id, participante_tipo, participante_id, fecha, tipo, nivel_id, estado
    ) values (
      p_socio_id, v_tipo, v_id, p_fecha, p_tipo, v_nivel, 'pendiente'
    );

    -- Sincronizar el nivel del perfil para la disciplina elegida
    if v_tipo = 'socio' then
      if p_tipo = 'esqui' then
        update socios set nivel_esqui_id = v_nivel where id = v_id;
      else
        update socios set nivel_snowboard_id = v_nivel where id = v_id;
      end if;
    else
      if p_tipo = 'esqui' then
        update beneficiarios set nivel_esqui_id = v_nivel where id = v_id;
      else
        update beneficiarios set nivel_snowboard_id = v_nivel where id = v_id;
      end if;
    end if;
  end loop;
end;
$$;

grant execute on function crear_solicitudes_clase(uuid, date, text, jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- Permisos Fase 2: gestor edita la gestión de clases y lector la ve
-- en modo lectura (las filas ya existen desde la migración de Fase 1).
-- ------------------------------------------------------------
update permisos_rol set nivel = 'completo' where rol = 'gestor' and seccion = 'clases_gestion';
update permisos_rol set nivel = 'lectura'  where rol = 'lector' and seccion = 'clases_gestion';

notify pgrst, 'reload schema';
