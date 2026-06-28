-- ============================================================
-- Amarrar un cheque a un movimiento de cartola (fuente única)
-- ============================================================
-- Problema: el depósito de un cheque llega a la cartola como un
-- movimiento genérico ("Depósito Documento Otros Bancos"), sin RUT ni
-- nombre, así que el matcher automático no lo liga. Al conciliarlo a
-- mano el frontend creaba un pagos_cuota NUEVO en vez de amarrar el
-- cheque depositado existente → el cheque quedaba con movimiento_id
-- null (sin conciliar) y un pago suelto sin cheque_id.
--
-- Esta función centraliza el amarre de UN cheque a UN movimiento, de
-- forma atómica, cubriendo:
--   · Cambio 1 (Cartola, "Aplicar manualmente"): cheque depositado que
--     calza el monto → amarrar en vez de crear pago duplicado.
--   · Cambio 2 (Cartola): cheque 'por_depositar' → lo promueve a
--     'depositado' y lo amarra.
--   · Cambio 3 (Cheques, "Amarrar"): rescata cheques 'depositado'
--     huérfanos (movimiento_id null) y CONSOLIDA el pago suelto que
--     dejó la conciliación vieja (mismo movimiento, cheque_id null).
--
-- Regla de cuota (NO se rompe): un pago cuenta para la cuota anual si
-- concepto contiene "cuota" O es null/vacío. Los cheques de cuota
-- (concepto 'cuota_social') se reflejan vía pagos_cuota; los cheques
-- no-cuota (incorporación/otro) vía otros_ingresos. La función NUNCA
-- crea un segundo pago/ingreso si el movimiento ya tiene uno: consolida
-- o reusa, para que la recaudación no se duplique.
--
-- La fecha del banco manda: fecha_deposito del cheque y fecha_pago del
-- pago se sobrescriben con la fecha del movimiento bancario.
--
-- Idempotente: create or replace function.
-- ============================================================
create or replace function amarrar_cheque_a_movimiento(
  p_cheque_id     uuid,
  p_movimiento_id uuid,
  p_usuario_id    uuid
) returns void
language plpgsql
as $$
declare
  v_mov           movimientos%rowtype;
  v_cheque        cheques%rowtype;
  v_es_cuota      boolean;
  v_pago_propio   pagos_cuota%rowtype;
  v_pago_huerfano pagos_cuota%rowtype;
  v_otro_existe   uuid;
begin
  -- 0. Cheque: existe, sin amarrar, no anulado
  select * into v_cheque from cheques where id = p_cheque_id for update;
  if not found then
    raise exception 'cheque % no existe', p_cheque_id;
  end if;
  if v_cheque.movimiento_id is not null then
    raise exception 'el cheque ya está conciliado con un movimiento';
  end if;
  if v_cheque.estado = 'anulado' then
    raise exception 'el cheque está anulado';
  end if;

  -- 1. Movimiento: existe, es abono, monto coincide
  select * into v_mov from movimientos where id = p_movimiento_id for update;
  if not found then
    raise exception 'movimiento % no existe', p_movimiento_id;
  end if;
  if v_mov.tipo <> 'abono' then
    raise exception 'el movimiento no es un abono (tipo=%)', v_mov.tipo;
  end if;
  if v_cheque.monto <> abs(v_mov.monto) then
    raise exception 'monto del cheque (%) no coincide con el movimiento (%)', v_cheque.monto, abs(v_mov.monto);
  end if;

  v_es_cuota := lower(coalesce(v_cheque.concepto, '')) like '%cuota%';

  -- 2. Amarrar el cheque (la fecha del banco manda; promueve por_depositar → depositado)
  update cheques
     set movimiento_id  = p_movimiento_id,
         estado         = 'depositado',
         fecha_deposito = v_mov.fecha,
         conciliado_en  = now(),
         conciliado_por = p_usuario_id
   where id = p_cheque_id;

  if v_es_cuota then
    -- 3a. ¿El cheque ya tiene su propio pago de cuota sin conciliar? → ligarlo
    select * into v_pago_propio
      from pagos_cuota
     where cheque_id = p_cheque_id and movimiento_id is null
     limit 1;
    if found then
      update pagos_cuota
         set movimiento_id  = p_movimiento_id,
             fecha_pago     = v_mov.fecha,
             conciliado_en  = now(),
             conciliado_por = p_usuario_id
       where id = v_pago_propio.id;
    else
      -- 3b. ¿Hay un pago suelto en este movimiento (cheque_id null)? → CONSOLIDAR
      select * into v_pago_huerfano
        from pagos_cuota
       where movimiento_id = p_movimiento_id and cheque_id is null
       limit 1;
      if found then
        update pagos_cuota
           set cheque_id      = p_cheque_id,
               fecha_pago     = v_mov.fecha,
               conciliado_en  = coalesce(conciliado_en, now()),
               conciliado_por = coalesce(conciliado_por, p_usuario_id)
         where id = v_pago_huerfano.id;
      elsif v_mov.estado = 'conciliado' then
        -- El movimiento ya está conciliado pero no hay pago suelto que
        -- consolidar: crear uno nuevo duplicaría la recaudación.
        raise exception 'el movimiento ya está conciliado y no tiene un pago suelto para consolidar; desconcílialo primero';
      else
        -- 3c. Crear el pago de cuota ligado al cheque y al movimiento.
        -- concepto null = cuenta como cuota (regla de cuota).
        insert into pagos_cuota (
          socio_id, periodo_id, monto, fecha_pago, forma_pago,
          movimiento_id, cheque_id, concepto, comentario,
          conciliado_en, conciliado_por
        ) values (
          v_cheque.socio_id, null, v_cheque.monto, v_mov.fecha, 'cheque',
          p_movimiento_id, p_cheque_id, null, 'Amarrado desde cheque depositado',
          now(), p_usuario_id
        );
      end if;
    end if;
  else
    -- Cheque no-cuota (incorporación / otro) → otros_ingresos
    select id into v_otro_existe
      from otros_ingresos
     where movimiento_id = p_movimiento_id
     limit 1;
    if v_otro_existe is not null then
      null; -- ya hay un ingreso en el movimiento; no duplicar
    elsif v_mov.estado = 'conciliado' then
      raise exception 'el movimiento ya está conciliado y no tiene un ingreso para consolidar; desconcílialo primero';
    else
      insert into otros_ingresos (
        movimiento_id, cartola_id, fecha, descripcion, concepto, monto,
        origen, conciliado_en, conciliado_por
      ) values (
        p_movimiento_id, v_mov.cartola_id, v_mov.fecha,
        v_cheque.concepto_descripcion, coalesce(v_cheque.concepto, 'Cheque'),
        v_cheque.monto, 'cartola', now(), p_usuario_id
      );
    end if;
  end if;

  -- 4. Marcar el movimiento conciliado (idempotente si ya lo estaba)
  update movimientos
     set estado           = 'conciliado',
         monto_conciliado = v_cheque.monto,
         monto_pendiente  = 0,
         socio_id         = coalesce(v_cheque.socio_id, socio_id)
   where id = p_movimiento_id;
end;
$$;

-- El frontend usa la anon key (auth propia vía tabla `usuarios`), así que
-- el rol que invoca el RPC es `anon`.
grant execute on function amarrar_cheque_a_movimiento(uuid, uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
