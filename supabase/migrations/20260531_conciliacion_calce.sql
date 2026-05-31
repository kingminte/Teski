-- ============================================================
-- Conciliación cartola ↔ ingresos manuales
-- Agrega columnas de auditoría y la función calzar_movimiento_con_ingreso
-- que ejecuta el calce en una sola transacción.
-- ============================================================

alter table pagos_cuota    add column if not exists conciliado_en  timestamptz;
alter table pagos_cuota    add column if not exists conciliado_por uuid references usuarios(id) on delete set null;

alter table cheques        add column if not exists conciliado_en  timestamptz;
alter table cheques        add column if not exists conciliado_por uuid references usuarios(id) on delete set null;

alter table otros_ingresos add column if not exists conciliado_en  timestamptz;
alter table otros_ingresos add column if not exists conciliado_por uuid references usuarios(id) on delete set null;

-- ------------------------------------------------------------
-- RPC: calzar_movimiento_con_ingreso
-- Toda la operación corre en una sola transacción (Postgres
-- envuelve cada función plpgsql en BEGIN/COMMIT). Si algún paso
-- lanza, revierte todo.
-- ------------------------------------------------------------
create or replace function calzar_movimiento_con_ingreso(
  p_movimiento_id uuid,
  p_tipo_ingreso  text,
  p_ingreso_id    uuid,
  p_usuario_id    uuid
) returns void
language plpgsql
as $$
declare
  v_mov            movimientos%rowtype;
  v_pago           pagos_cuota%rowtype;
  v_cheque         cheques%rowtype;
  v_otro           otros_ingresos%rowtype;
  v_monto_ingreso  integer;
  v_socio_id       uuid;
begin
  -- 0. Movimiento existe y es abono
  select * into v_mov from movimientos where id = p_movimiento_id for update;
  if not found then
    raise exception 'movimiento % no existe', p_movimiento_id;
  end if;
  if v_mov.tipo <> 'abono' then
    raise exception 'el movimiento no es un abono (tipo=%)', v_mov.tipo;
  end if;
  if v_mov.estado = 'conciliado' then
    raise exception 'el movimiento ya está conciliado';
  end if;

  if p_tipo_ingreso = 'pagos_cuota' then
    select * into v_pago from pagos_cuota where id = p_ingreso_id for update;
    if not found then
      raise exception 'pago_cuota % no existe', p_ingreso_id;
    end if;
    if v_pago.movimiento_id is not null then
      raise exception 'el pago_cuota ya está conciliado con otro movimiento';
    end if;
    if v_pago.monto <> abs(v_mov.monto) then
      raise exception 'monto del pago (%) no coincide con el movimiento (%)', v_pago.monto, abs(v_mov.monto);
    end if;

    v_monto_ingreso := v_pago.monto;
    v_socio_id := v_pago.socio_id;

    update pagos_cuota
       set movimiento_id  = p_movimiento_id,
           conciliado_en  = now(),
           conciliado_por = p_usuario_id
     where id = p_ingreso_id;

    -- Si el pago tiene cheque asociado, propagar al cheque
    if v_pago.cheque_id is not null then
      update cheques
         set movimiento_id  = p_movimiento_id,
             estado         = 'depositado',
             conciliado_en  = now(),
             conciliado_por = p_usuario_id
       where id = v_pago.cheque_id;
    end if;

  elsif p_tipo_ingreso = 'cheque' then
    select * into v_cheque from cheques where id = p_ingreso_id for update;
    if not found then
      raise exception 'cheque % no existe', p_ingreso_id;
    end if;
    if v_cheque.movimiento_id is not null then
      raise exception 'el cheque ya está conciliado con otro movimiento';
    end if;
    if v_cheque.monto <> abs(v_mov.monto) then
      raise exception 'monto del cheque (%) no coincide con el movimiento (%)', v_cheque.monto, abs(v_mov.monto);
    end if;
    -- Caso borde: cheque marcado como cuota sin pago_cuota asociado.
    -- Lo bloqueamos por ahora — el frontend no debería llamar al RPC en este caso.
    if lower(coalesce(v_cheque.concepto, '')) like '%cuota%' then
      raise exception 'cheque con concepto cuota: calzar manualmente desde el flujo de cuotas';
    end if;

    v_monto_ingreso := v_cheque.monto;
    v_socio_id := v_cheque.socio_id;

    update cheques
       set movimiento_id  = p_movimiento_id,
           estado         = 'depositado',
           conciliado_en  = now(),
           conciliado_por = p_usuario_id
     where id = p_ingreso_id;

    -- Crear otros_ingresos para que aparezca en el reporte financiero
    -- bajo la categoría que tenía el cheque.
    insert into otros_ingresos (
      movimiento_id, cartola_id, fecha, descripcion, concepto, monto,
      origen, conciliado_en, conciliado_por
    ) values (
      p_movimiento_id, v_mov.cartola_id, v_mov.fecha,
      v_cheque.concepto_descripcion, coalesce(v_cheque.concepto, 'Cheque'),
      v_cheque.monto, 'cartola', now(), p_usuario_id
    );

  elsif p_tipo_ingreso = 'otros_ingresos' then
    select * into v_otro from otros_ingresos where id = p_ingreso_id for update;
    if not found then
      raise exception 'otros_ingresos % no existe', p_ingreso_id;
    end if;
    if v_otro.movimiento_id is not null then
      raise exception 'el ingreso ya está conciliado con otro movimiento';
    end if;
    if v_otro.monto <> abs(v_mov.monto) then
      raise exception 'monto del ingreso (%) no coincide con el movimiento (%)', v_otro.monto, abs(v_mov.monto);
    end if;

    v_monto_ingreso := v_otro.monto;
    v_socio_id := null;

    update otros_ingresos
       set movimiento_id  = p_movimiento_id,
           conciliado_en  = now(),
           conciliado_por = p_usuario_id
     where id = p_ingreso_id;

  else
    raise exception 'tipo_ingreso inválido: % (debe ser pagos_cuota | cheque | otros_ingresos)', p_tipo_ingreso;
  end if;

  -- Marcar el movimiento como conciliado
  update movimientos
     set estado            = 'conciliado',
         monto_conciliado  = v_monto_ingreso,
         monto_pendiente   = 0,
         socio_id          = coalesce(v_socio_id, socio_id)
   where id = p_movimiento_id;
end;
$$;

-- El frontend se conecta con la anon key (auth propia vía tabla `usuarios`,
-- no Supabase Auth), así que el rol que invoca el RPC es `anon`, no `authenticated`.
grant execute on function calzar_movimiento_con_ingreso(uuid, text, uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
