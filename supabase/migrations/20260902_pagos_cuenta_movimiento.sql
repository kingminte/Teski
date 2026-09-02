-- ============================================================
-- Cuentas por pagar ↔ cartola: vínculo del pago con el movimiento
-- ============================================================
-- Un egreso de la cartola se vinculaba SOLO contra chequera_detalle (por folio).
-- Los pagos hechos por otra vía —el giro por caja en efectivo, la transferencia—
-- no tienen folio, así que ese cargo se quedaba sin ningún candidato posible.
--
-- pagos_cuenta.movimiento_id es el lado del pago en ese vínculo. El otro lado es
-- el estado/montos del movimiento; los dos se escriben juntos desde Cartola.jsx
-- (handleVincularPagoCxP / handleDesvincularPagoCxP), mismo patrón espejo que el
-- vínculo cheque ↔ movimiento de 20260804_calce_cheque_espejo.sql.
--
-- La columna ya fue creada a mano en producción (02-09-2026); esta migración la deja
-- registrada para que el esquema del repo sea reproducible. Ojo: sobre una columna
-- que ya existe, `add column if not exists` NO agrega la referencia — si la creaste
-- sin FK, en producción queda sin ella (el índice único de abajo sí se aplica).
-- Idempotente: add column / create index if not exists.
-- ============================================================
alter table pagos_cuenta add column if not exists movimiento_id uuid
  references movimientos(id) on delete set null;

comment on column pagos_cuenta.movimiento_id is
  'Movimiento de cartola que corresponde a este pago. Null = pago aún sin conciliar contra la cartola.';

-- Un movimiento no puede quedar vinculado a dos pagos distintos.
create unique index if not exists pagos_cuenta_movimiento_id_uniq
  on pagos_cuenta (movimiento_id) where movimiento_id is not null;

notify pgrst, 'reload schema';
