import { supabase } from './supabase'

// Fuente única de verdad para el estado de una cuenta por pagar.
//
// `cuentas_por_pagar.monto_pagado` y `.estado` son campos materializados, pero
// NO se calculan de forma incremental: se derivan siempre de la suma de
// `pagos_cuenta` con estado 'pagado'. Antes cada sitio hacía
// `monto_pagado + monto` sobre el valor en memoria, y cualquier escritura
// fallida a mitad de camino dejaba la cuenta desincronizada para siempre.
// Recalcular desde la base hace que cada operación también repare el estado.

// Lee la cuenta y sus pagos, y devuelve el pagado/saldo derivados de
// `pagos_cuenta` (no del campo materializado, que puede estar viejo).
export async function leerEstadoCuenta(cuentaId) {
  const { data: cuenta, error: eCuenta } = await supabase
    .from('cuentas_por_pagar')
    .select('id,concepto,monto_total,monto_pagado,estado')
    .eq('id', cuentaId)
    .maybeSingle()
  if (eCuenta) return { error: eCuenta }
  if (!cuenta) return { error: { message: 'La cuenta ya no existe' } }

  const { data: pagos, error: ePagos } = await supabase
    .from('pagos_cuenta')
    .select('id,monto,estado')
    .eq('cuenta_id', cuentaId)
  if (ePagos) return { error: ePagos }

  const pagado = (pagos || [])
    .filter(p => p.estado === 'pagado')
    .reduce((s, p) => s + (p.monto || 0), 0)

  return { cuenta, pagos: pagos || [], pagado, saldo: (cuenta.monto_total || 0) - pagado }
}

// pagada si cubre el total, parcial si hay algo abonado, pendiente si nada.
export function estadoSegunPagado(pagado, montoTotal) {
  if (pagado <= 0) return 'pendiente'
  return pagado >= montoTotal ? 'pagada' : 'parcial'
}

// Recalcula y persiste monto_pagado + estado desde `pagos_cuenta`.
// 'anulada' se preserva: una cuenta anulada no revive por tener pagos.
export async function recalcularCuenta(cuentaId) {
  const res = await leerEstadoCuenta(cuentaId)
  if (res.error) return { error: res.error }

  const estado = res.cuenta.estado === 'anulada'
    ? 'anulada'
    : estadoSegunPagado(res.pagado, res.cuenta.monto_total || 0)

  const { error } = await supabase
    .from('cuentas_por_pagar')
    .update({ monto_pagado: res.pagado, estado })
    .eq('id', cuentaId)
  if (error) return { error }

  return { monto_pagado: res.pagado, estado, saldo: res.saldo }
}

// Chequera activa + próximo folio libre, validado contra folio_final.
// Centraliza el cálculo que antes estaba copiado en tres sitios.
export async function obtenerChequeraYFolio() {
  const { data: chequera, error } = await supabase
    .from('chequeras').select('*').eq('estado', 'activa').limit(1).maybeSingle()
  if (error) return { error }
  if (!chequera) return { error: { message: 'No hay chequera activa. Crea una en Control chequera primero.' } }

  const { data: usados } = await supabase
    .from('chequera_detalle').select('folio')
    .eq('chequera_id', chequera.id)
    .order('folio', { ascending: false }).limit(1)

  const ultimoFolio = usados?.[0]?.folio
  const folio = ultimoFolio ? ultimoFolio + 1 : chequera.folio_inicial
  if (folio > chequera.folio_final) {
    return { error: { message: `Chequera agotada (último folio ${chequera.folio_final})` } }
  }

  return { chequera, folio }
}
