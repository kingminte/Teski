-- ============================================================
-- Calce de cheques: el concepto que llega al reporte es la ETIQUETA
-- ============================================================
-- El RPC copiaba a otros_ingresos.concepto el valor crudo de cheques.concepto
-- ('incorporacion', 'otro'). En el Reporte financiero eso abría una categoría
-- "incorporacion" en paralelo a la "Incorporación" que ya venía del plan de
-- cuentas: dos líneas para el mismo concepto, con el total partido.
--
-- Esta migración RE-CREA calzar_movimiento_con_ingreso sobre la versión de
-- 20260804_calce_cheque_espejo.sql. Únicos cambios, ambos en la rama 'cheque':
--   1. concepto: se mapea el enum a su etiqueta visible
--      ('incorporacion' → 'Incorporación', 'otro' → 'Otros ingresos').
--   2. descripcion: pasa de concepto_descripcion (casi siempre vacío) a
--      'Cheque N° {numero} — {nombre socio} ({numero_socio})'.
--
-- El resto de la función queda idéntico: espejo cheque ↔ movimiento, guard de
-- doble amarre y respaldo de fecha_documento siguen igual.
--
-- El frontend además agrupa conceptos ignorando mayúsculas y tildes, así que
-- las filas ya escritas con el valor crudo se consolidan solas en el reporte;
-- esta migración corta el problema en la raíz para las nuevas.
--
-- No crea tablas ni columnas. Idempotente: create or replace function.
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
  v_concepto_lbl   text;          -- etiqueta visible del concepto del cheque
  v_socio_nombre   text;
  v_socio_numero   text;
  v_descripcion    text;
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
    --
    -- cheques.concepto guarda el valor crudo del enum ('incorporacion', 'otro').
    -- Copiarlo tal cual abría una categoría "incorporacion" al lado de la
    -- "Incorporación" que ya existía: dos líneas para lo mismo en el reporte.
    -- Se mapea a la etiqueta visible antes de escribir.
    v_concepto_lbl := case lower(coalesce(v_cheque.concepto, ''))
                        when 'incorporacion' then 'Incorporación'
                        when 'otro'          then 'Otros ingresos'
                        else coalesce(nullif(v_cheque.concepto, ''), 'Otros ingresos')
                      end;

    -- Descripción legible: de dónde salió la plata, sin abrir el cheque.
    select s.nombre || ' ' || s.apellido, s.numero_socio
      into v_socio_nombre, v_socio_numero
      from socios s where s.id = v_cheque.socio_id;

    v_descripcion := 'Cheque N° ' || coalesce(v_cheque.numero, '?');
    if v_socio_nombre is not null then
      v_descripcion := v_descripcion || ' — ' || v_socio_nombre
                       || coalesce(' (' || v_socio_numero || ')', '');
    end if;

    insert into otros_ingresos (
      movimiento_id, cartola_id, fecha, descripcion, concepto, monto,
      origen, conciliado_en, conciliado_por
    ) values (
      p_movimiento_id, v_mov.cartola_id, v_mov.fecha,
      v_descripcion, v_concepto_lbl,
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

notify pgrst, 'reload schema';
