// Resolución de la categoría de gasto de un cargo bancario.
//
// Un cargo puede llegar a su categoría por tres caminos, y no todos están
// siempre presentes. El orden importa: el dato más específico gana.
//
//   1. El cheque de la chequera con que se pagó (chequera_detalle.categoria).
//   2. La cuenta por pagar que ese movimiento saldó (cuentas_por_pagar.categoria).
//   3. La categoría escrita a mano sobre el movimiento (movimientos.categoria),
//      que es el camino de los cargos históricos que solo viven en la cartola.
//   4. "Otros gastos" como último recurso: un cargo nunca desaparece del total.
//
// Los nombres vienen de plan_cuentas y algunos traen espacios al borde
// ("Clases Esquí "), así que se recortan para que no abran dos líneas.

export const CATEGORIA_SIN = 'Otros gastos'

export function resolverCategoriaCargo({ cheque, cuenta, movimiento } = {}) {
  const lim = (v) => (v || '').trim()
  return lim(cheque) || lim(cuenta) || lim(movimiento) || CATEGORIA_SIN
}

// Etiqueta de la línea negativa con que una devolución se netea dentro de la
// categoría del cargo que revierte.
export const ETIQUETA_DEVOLUCION = 'Devolución — cheque protestado'
