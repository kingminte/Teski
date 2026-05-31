-- ============================================================
-- Cheques: 3 fechas con significados distintos
-- ============================================================
-- Un cheque tiene tres fechas, todas útiles, y todas se preservan:
--
--   fecha_recepcion (NUEVA): cuándo el club recibió físicamente el
--     cheque de manos del socio. Default sugerido en el formulario: hoy.
--
--   fecha_documento (NUEVA): la fecha escrita en el cheque ("a fecha").
--     Es la fecha a partir de la cual el cheque es válido para depositar.
--
--   fecha_deposito (YA EXISTE, sin cambios de schema): la fecha real en
--     que el cheque cae en la cartola bancaria. Queda null hasta que se
--     concilie el movimiento; el RPC calzar_movimiento_con_ingreso la
--     setea con la fecha del movimiento (ver 20260531_calzar_fecha_cartola.sql).
--
-- Idempotente: add column if not exists.
-- No hace backfill de datos existentes (decisión confirmada).
-- ============================================================
alter table cheques add column if not exists fecha_recepcion date;
alter table cheques add column if not exists fecha_documento date;

comment on column cheques.fecha_recepcion is
  'Cuándo el club recibió físicamente el cheque del socio. Default en formulario: hoy.';
comment on column cheques.fecha_documento is
  'Fecha escrita en el cheque ("a fecha"): desde cuándo es válido para depositar.';
comment on column cheques.fecha_deposito is
  'Fecha real en que el cheque cae en cartola bancaria. Null hasta conciliar; la setea el RPC calzar_movimiento_con_ingreso.';

notify pgrst, 'reload schema';
