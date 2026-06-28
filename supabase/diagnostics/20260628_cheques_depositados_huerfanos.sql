-- ============================================================
-- DIAGNÓSTICO (solo lectura) — Cheques depositados huérfanos
-- ============================================================
-- NO modifica nada. Lista cada cheque 'depositado' que quedó sin
-- amarrar (movimiento_id null) junto a los pagos_cuota candidatos del
-- mismo socio y monto, mostrando cuál tiene movimiento y cuál tiene
-- cheque_id. Sirve para decidir caso a caso qué consolidar antes de
-- tocar datos. Casos conocidos: S-002 Felipe Silva (cheques 2599436
-- may / 2599437 jun) y S-003 Danilo Báez (7100183 may / 7100184 jun);
-- el pago "Cuota social" suelto debe consolidarse con el cheque de MAYO.
-- ============================================================
select
  s.numero_socio,
  s.nombre || ' ' || s.apellido               as socio,
  ch.numero                                    as cheque_numero,
  ch.monto                                     as cheque_monto,
  ch.fecha_deposito                            as cheque_fecha_deposito,
  ch.concepto                                  as cheque_concepto,
  p.id                                         as pago_id,
  p.monto                                      as pago_monto,
  p.fecha_pago                                 as pago_fecha,
  p.concepto                                   as pago_concepto,
  p.movimiento_id                              as pago_movimiento_id,
  p.cheque_id                                  as pago_cheque_id,
  case
    when p.id is null                          then 'cheque sin pago candidato'
    when p.cheque_id = ch.id                   then 'ya ligado a este cheque'
    when p.cheque_id is not null               then 'pago ligado a OTRO cheque'
    when p.movimiento_id is not null           then 'pago SUELTO (con movimiento, sin cheque) → consolidar'
    else 'pago suelto sin movimiento'
  end                                          as situacion
from cheques ch
join socios s on s.id = ch.socio_id
left join pagos_cuota p
       on p.socio_id = ch.socio_id
      and p.monto    = ch.monto
where ch.estado = 'depositado'
  and ch.movimiento_id is null
order by s.numero_socio, ch.fecha_deposito, ch.numero, p.fecha_pago;
