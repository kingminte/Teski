-- ============================================================
-- Clases de esquí — Fase 3A: marcar realizada con asistencia
-- ============================================================
-- Dos RPCs atómicas:
--   marcar_clase_realizada: registra asistencia individual, fija el
--     estado de cada solicitud (realizada/no_realizada) y del grupo.
--     Si nadie asistió → grupo 'no_realizada' (no se cobra a Andacor).
--   revertir_clase_realizada: vuelve el grupo y sus solicitudes a
--     'agendada' y borra la asistencia. La regla de quién puede revertir
--     se aplica en el frontend (consistente con el resto del proyecto).
--
-- Idempotente: create or replace function. No toca el esquema (las
-- columnas y la tabla clases_asistencia ya existen desde Fase 1).
-- ============================================================

create or replace function marcar_clase_realizada(
  p_grupo_id     uuid,
  p_asistencias  jsonb,   -- array de { solicitud_id, asistio, comentario? }
  p_usuario_id   uuid
) returns void
language plpgsql
as $$
declare
  v_grupo              clases_grupos%rowtype;
  v_asist              jsonb;
  v_solicitud_id       uuid;
  v_asistio            boolean;
  v_comentario         text;
  v_alguno_asistio     boolean := false;
  v_estado_grupo       text;
  v_estado_sol         text;
begin
  -- 0. Validar grupo
  select * into v_grupo from clases_grupos where id = p_grupo_id for update;
  if not found then
    raise exception 'grupo % no existe', p_grupo_id;
  end if;
  if v_grupo.estado <> 'agendada' then
    raise exception 'el grupo no está en estado agendada (estado=%)', v_grupo.estado;
  end if;

  -- 1. ¿Asistió al menos uno?
  for v_asist in select * from jsonb_array_elements(p_asistencias) loop
    if (v_asist->>'asistio')::boolean then
      v_alguno_asistio := true;
      exit;
    end if;
  end loop;

  v_estado_grupo := case when v_alguno_asistio then 'realizada' else 'no_realizada' end;

  -- 2. Asistencia individual (upsert) + estado de cada solicitud
  for v_asist in select * from jsonb_array_elements(p_asistencias) loop
    v_solicitud_id := (v_asist->>'solicitud_id')::uuid;
    v_asistio      := (v_asist->>'asistio')::boolean;
    v_comentario   := v_asist->>'comentario';

    insert into clases_asistencia (grupo_id, solicitud_id, asistio, comentario)
    values (p_grupo_id, v_solicitud_id, v_asistio, v_comentario)
    on conflict (grupo_id, solicitud_id) do update
      set asistio = excluded.asistio,
          comentario = excluded.comentario;

    v_estado_sol := case
      when not v_alguno_asistio then 'no_realizada'
      when v_asistio then 'realizada'
      else 'no_realizada'
    end;

    update clases_solicitudes set estado = v_estado_sol where id = v_solicitud_id;
  end loop;

  -- 3. Estado del grupo
  update clases_grupos
     set estado = v_estado_grupo,
         realizada_en = now(),
         realizada_por = p_usuario_id
   where id = p_grupo_id;
end;
$$;

grant execute on function marcar_clase_realizada(uuid, jsonb, uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- Revertir una clase realizada/no_realizada a 'agendada'.
-- ------------------------------------------------------------
create or replace function revertir_clase_realizada(
  p_grupo_id   uuid,
  p_usuario_id uuid
) returns void
language plpgsql
as $$
declare
  v_grupo clases_grupos%rowtype;
begin
  select * into v_grupo from clases_grupos where id = p_grupo_id for update;
  if not found then
    raise exception 'grupo % no existe', p_grupo_id;
  end if;
  if v_grupo.estado not in ('realizada', 'no_realizada') then
    raise exception 'el grupo no está marcado como realizada (estado=%)', v_grupo.estado;
  end if;

  delete from clases_asistencia where grupo_id = p_grupo_id;

  update clases_solicitudes
     set estado = 'agendada'
   where grupo_id = p_grupo_id
     and estado in ('realizada', 'no_realizada');

  update clases_grupos
     set estado = 'agendada',
         realizada_en = null,
         realizada_por = null
   where id = p_grupo_id;
end;
$$;

grant execute on function revertir_clase_realizada(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
