-- ============================================================
-- Calce de cheques: el vínculo se escribe en espejo
-- ============================================================
-- El vínculo cheque ↔ movimiento vive en DOS columnas:
--     cheques.movimiento_id  ↔  movimientos.cheque_id
-- El RPC escribía sólo la primera. movimientos.cheque_id quedaba null,
-- así que nada podía detectar que ese movimiento ya tenía cheque: de ahí
-- el doble amarre (dos cheques al mismo movimiento) visto en producción.
--
-- Además, el RPC pisa cheques.fecha_deposito con la fecha de la cartola
-- (regla de 20260531_calzar_fecha_cartola.sql: la fecha del banco manda).
-- Eso borraba sin respaldo la fecha original del cheque, y al descalzar no
-- había desde dónde devolverla. Ahora, antes de pisarla, se copia a
-- fecha_documento si estaba vacía.
--
-- Cambios respecto de 20260531_calzar_fecha_cartola.sql (única diferencia):
--   1. GUARD: aborta si el movimiento ya tiene cheque_id.
--   2. Rama 'cheque' y rama 'pagos_cuota'-con-cheque: respaldan
--      fecha_documento antes de pisar fecha_deposito.
--   3. El update final de movimientos setea cheque_id (el espejo).
--
-- No crea tablas ni columnas: fecha_documento y movimientos.cheque_id ya existen.
-- Idempotente: create or replace function.
-- ============================================================
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
  v_cheque_id      uuid;          -- cheque a enlazar en movimientos.cheque_id
  v_numero_ocupa   text;
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
  -- GUARD contra doble amarre: el movimiento ya tiene un cheque enlazado.
  if v_mov.cheque_id is not null then
    select numero into v_numero_ocupa from cheques where id = v_mov.cheque_id;
    raise exception 'Este movimiento ya está conciliado con el cheque N° %', coalesce(v_numero_ocupa, v_mov.cheque_id::text);
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
           fecha_pago     = v_mov.fecha,        -- la fecha del banco manda
           conciliado_en  = now(),
           conciliado_por = p_usuario_id
     where id = p_ingreso_id;

    -- Si el pago tiene cheque asociado, propagar al cheque
    if v_pago.cheque_id is not null then
      v_cheque_id := v_pago.cheque_id;
      update cheques
         set movimiento_id  = p_movimiento_id,
             estado         = 'depositado',
             -- respaldo de la fecha original antes de pisarla
             fecha_documento = coalesce(fecha_documento, fecha_deposito),
             fecha_deposito = v_mov.fecha,      -- el cheque cayó en el banco en esta fecha
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
    v_cheque_id := v_cheque.id;

    update cheques
       set movimiento_id  = p_movimiento_id,
           estado         = 'depositado',
           -- respaldo de la fecha original antes de pisarla: sin esto, el descalce
           -- no tiene desde dónde devolver la fecha propia del cheque
           fecha_documento = coalesce(fecha_documento, fecha_deposito),
           fecha_deposito = v_mov.fecha,        -- la fecha del banco manda
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
           fecha          = v_mov.fecha,        -- la fecha del banco manda
           conciliado_en  = now(),
           conciliado_por = p_usuario_id
     where id = p_ingreso_id;

  else
    raise exception 'tipo_ingreso inválido: % (debe ser pagos_cuota | cheque | otros_ingresos)', p_tipo_ingreso;
  end if;

  -- Marcar el movimiento como conciliado. cheque_id cierra el espejo del vínculo:
  -- se escribe en la MISMA transacción que cheques.movimiento_id, así que los dos
  -- lados quedan siempre juntos o ninguno.
  update movimientos
     set estado            = 'conciliado',
         monto_conciliado  = v_monto_ingreso,
         monto_pendiente   = 0,
         socio_id          = coalesce(v_socio_id, socio_id),
         cheque_id         = coalesce(v_cheque_id, cheque_id)
   where id = p_movimiento_id;
end;
$$;

-- El frontend se conecta con la anon key (auth propia vía tabla `usuarios`,
-- no Supabase Auth), así que el rol que invoca el RPC es `anon`, no `authenticated`.
grant execute on function calzar_movimiento_con_ingreso(uuid, text, uuid, uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- BACKFILL del espejo faltante
-- ------------------------------------------------------------
-- Los calces hechos antes de esta migración escribieron sólo cheques.movimiento_id.
-- Al 04-08-2026 son 6 movimientos con cheque_id null pese a tener cheque amarrado.
-- Se rellena desde el lado autoritativo (cheques.movimiento_id).
--
-- Sólo toca movimientos con cheque_id NULL y con EXACTAMENTE UN cheque apuntándolos:
-- si hubiera un doble amarre sin resolver, el backfill lo deja intacto en vez de
-- elegir un cheque al azar (queda visible en scripts/auditar-vinculo-cheques.mjs).
-- Idempotente: correrlo de nuevo no afecta filas.
update movimientos m
   set cheque_id = c.id
  from cheques c
 where c.movimiento_id = m.id
   and m.cheque_id is null
   and (select count(*) from cheques c2 where c2.movimiento_id = m.id) = 1;

notify pgrst, 'reload schema';
