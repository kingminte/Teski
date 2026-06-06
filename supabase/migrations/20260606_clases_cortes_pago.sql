-- ============================================================
-- Clases de esquí — Fase 3B: cortes de pago y reporte mensual
-- ============================================================
-- Modelo "fecha contable": una clase realizada se asigna al corte
-- ABIERTO en el momento de marcarla. La tarifa se congela al cerrar el
-- corte (snapshot), para que ajustes futuros no alteren reportes
-- históricos. Solo puede haber un corte 'abierto' a la vez.
--
-- Incluye la re-creación de marcar_clase_realizada / revertir_clase_realizada
-- (Fase 3A) para integrar corte_id. Idempotente (create or replace,
-- add column if not exists, updates).
-- ============================================================

create table if not exists clases_cortes_pago (
  id uuid primary key default gen_random_uuid(),
  numero serial,
  fecha_inicio date not null,
  fecha_fin date,
  estado text not null default 'abierto' check (estado in ('abierto','cerrado','pagado')),
  tarifa_snapshot integer,
  horas_calculadas numeric(10,2),
  monto_calculado integer,
  ajuste integer not null default 0,
  comentario_ajuste text,
  monto_final integer,
  pagado_en timestamptz,
  pagado_por uuid references usuarios(id) on delete set null,
  referencia_pago text,
  comentario_pago text,
  created_at timestamptz not null default now(),
  created_by uuid references usuarios(id) on delete set null
);

-- RLS: mismo patrón que el resto del esquema (for all using (true), a PUBLIC,
-- que cubre el rol anon con el que se conecta el frontend). Sin esto la tabla
-- queda con RLS habilitado y sin políticas → 403 al llamar a los RPCs.
alter table clases_cortes_pago enable row level security;
drop policy if exists "anon clases_cortes_pago" on clases_cortes_pago;
create policy "anon clases_cortes_pago" on clases_cortes_pago for all using (true);

alter table clases_grupos
  add column if not exists corte_id uuid references clases_cortes_pago(id) on delete set null;

create index if not exists idx_clases_grupos_corte on clases_grupos(corte_id);

-- ------------------------------------------------------------
-- Gestión de cortes
-- ------------------------------------------------------------
create or replace function abrir_corte_pago(
  p_fecha_inicio date,
  p_usuario_id uuid
) returns uuid
language plpgsql
as $$
declare
  v_corte_abierto_id uuid;
  v_nuevo_id uuid;
begin
  select id into v_corte_abierto_id from clases_cortes_pago where estado = 'abierto' limit 1;
  if found then
    raise exception 'Ya hay un corte abierto. Cerralo antes de abrir uno nuevo.';
  end if;

  insert into clases_cortes_pago (fecha_inicio, estado, created_by)
  values (p_fecha_inicio, 'abierto', p_usuario_id)
  returning id into v_nuevo_id;

  return v_nuevo_id;
end;
$$;

create or replace function cerrar_corte_pago(
  p_corte_id uuid,
  p_fecha_fin date,
  p_usuario_id uuid
) returns void
language plpgsql
as $$
declare
  v_corte  clases_cortes_pago%rowtype;
  v_tarifa integer;
  v_horas  numeric(10,2);
  v_monto  integer;
begin
  select * into v_corte from clases_cortes_pago where id = p_corte_id for update;
  if not found then
    raise exception 'corte % no existe', p_corte_id;
  end if;
  if v_corte.estado <> 'abierto' then
    raise exception 'el corte no está abierto (estado=%)', v_corte.estado;
  end if;
  if p_fecha_fin < v_corte.fecha_inicio then
    raise exception 'la fecha de fin no puede ser anterior a la fecha de inicio';
  end if;

  select tarifa_hora_profesor into v_tarifa from clases_config where id = 1;
  if v_tarifa is null then v_tarifa := 0; end if;

  select coalesce(sum(extract(epoch from (hora_fin - hora_inicio)) / 3600), 0)::numeric(10,2)
    into v_horas
    from clases_grupos
    where corte_id = p_corte_id and estado = 'realizada';

  v_monto := round(v_horas * v_tarifa);

  update clases_cortes_pago
     set estado = 'cerrado',
         fecha_fin = p_fecha_fin,
         tarifa_snapshot = v_tarifa,
         horas_calculadas = v_horas,
         monto_calculado = v_monto,
         monto_final = v_monto
   where id = p_corte_id;
end;
$$;

create or replace function actualizar_ajuste_corte(
  p_corte_id uuid,
  p_ajuste integer,
  p_comentario text,
  p_usuario_id uuid
) returns void
language plpgsql
as $$
declare
  v_corte clases_cortes_pago%rowtype;
begin
  select * into v_corte from clases_cortes_pago where id = p_corte_id for update;
  if not found then
    raise exception 'corte % no existe', p_corte_id;
  end if;
  if v_corte.estado not in ('cerrado','pagado') then
    raise exception 'solo se puede ajustar un corte cerrado o pagado';
  end if;
  if p_ajuste <> 0 and (p_comentario is null or trim(p_comentario) = '') then
    raise exception 'el comentario es obligatorio cuando hay ajuste distinto de cero';
  end if;

  update clases_cortes_pago
     set ajuste = p_ajuste,
         comentario_ajuste = p_comentario,
         monto_final = monto_calculado + p_ajuste
   where id = p_corte_id;
end;
$$;

create or replace function marcar_corte_pagado(
  p_corte_id uuid,
  p_referencia text,
  p_comentario text,
  p_usuario_id uuid
) returns void
language plpgsql
as $$
declare
  v_corte clases_cortes_pago%rowtype;
begin
  select * into v_corte from clases_cortes_pago where id = p_corte_id for update;
  if not found then
    raise exception 'corte % no existe', p_corte_id;
  end if;
  if v_corte.estado <> 'cerrado' then
    raise exception 'solo se puede marcar como pagado un corte cerrado';
  end if;
  if p_referencia is null or trim(p_referencia) = '' then
    raise exception 'la referencia de pago es obligatoria';
  end if;

  update clases_cortes_pago
     set estado = 'pagado',
         pagado_en = now(),
         pagado_por = p_usuario_id,
         referencia_pago = p_referencia,
         comentario_pago = p_comentario
   where id = p_corte_id;
end;
$$;

create or replace function revertir_corte_pagado(
  p_corte_id uuid,
  p_usuario_id uuid
) returns void
language plpgsql
as $$
declare
  v_corte clases_cortes_pago%rowtype;
begin
  select * into v_corte from clases_cortes_pago where id = p_corte_id for update;
  if not found then
    raise exception 'corte % no existe', p_corte_id;
  end if;
  if v_corte.estado <> 'pagado' then
    raise exception 'solo se puede revertir un corte pagado';
  end if;

  update clases_cortes_pago
     set estado = 'cerrado',
         pagado_en = null,
         pagado_por = null,
         referencia_pago = null,
         comentario_pago = null
   where id = p_corte_id;
end;
$$;

-- ------------------------------------------------------------
-- Integración con Fase 3A: marcar/revertir asignan corte_id.
-- (create or replace, misma firma que en 20260606_clases_marcar_realizada.sql)
-- ------------------------------------------------------------
create or replace function marcar_clase_realizada(
  p_grupo_id     uuid,
  p_asistencias  jsonb,
  p_usuario_id   uuid
) returns void
language plpgsql
as $$
declare
  v_grupo          clases_grupos%rowtype;
  v_asist          jsonb;
  v_solicitud_id   uuid;
  v_asistio        boolean;
  v_comentario     text;
  v_alguno_asistio boolean := false;
  v_estado_grupo   text;
  v_estado_sol     text;
  v_corte_abierto  uuid;
begin
  select * into v_grupo from clases_grupos where id = p_grupo_id for update;
  if not found then
    raise exception 'grupo % no existe', p_grupo_id;
  end if;
  if v_grupo.estado <> 'agendada' then
    raise exception 'el grupo no está en estado agendada (estado=%)', v_grupo.estado;
  end if;

  -- Debe haber un corte abierto: la clase se asigna a él (fecha contable).
  select id into v_corte_abierto from clases_cortes_pago where estado = 'abierto' limit 1;
  if v_corte_abierto is null then
    raise exception 'No hay un corte de pago abierto. Pedile al administrador que abra uno en /clases/reporte antes de marcar clases como realizadas.';
  end if;

  for v_asist in select * from jsonb_array_elements(p_asistencias) loop
    if (v_asist->>'asistio')::boolean then
      v_alguno_asistio := true;
      exit;
    end if;
  end loop;

  v_estado_grupo := case when v_alguno_asistio then 'realizada' else 'no_realizada' end;

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

  update clases_grupos
     set estado = v_estado_grupo,
         corte_id = v_corte_abierto,
         realizada_en = now(),
         realizada_por = p_usuario_id
   where id = p_grupo_id;
end;
$$;

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
         corte_id = null,
         realizada_en = null,
         realizada_por = null
   where id = p_grupo_id;
end;
$$;

-- ------------------------------------------------------------
-- Grants y permisos
-- ------------------------------------------------------------
grant execute on function abrir_corte_pago(date, uuid) to anon, authenticated;
grant execute on function cerrar_corte_pago(uuid, date, uuid) to anon, authenticated;
grant execute on function actualizar_ajuste_corte(uuid, integer, text, uuid) to anon, authenticated;
grant execute on function marcar_corte_pagado(uuid, text, text, uuid) to anon, authenticated;
grant execute on function revertir_corte_pagado(uuid, uuid) to anon, authenticated;
grant execute on function marcar_clase_realizada(uuid, jsonb, uuid) to anon, authenticated;
grant execute on function revertir_clase_realizada(uuid, uuid) to anon, authenticated;

-- Reporte: admin (ya completo) + gestor (completo) + lector (lectura). Andacor NO ve tarifas.
update permisos_rol set nivel = 'completo' where rol = 'gestor' and seccion = 'clases_reporte';
update permisos_rol set nivel = 'lectura'  where rol = 'lector' and seccion = 'clases_reporte';
update permisos_rol set nivel = 'ninguno'  where rol = 'andacor' and seccion = 'clases_reporte';

notify pgrst, 'reload schema';
