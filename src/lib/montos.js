// Convierte cualquier formato de entrada a número entero
// Acepta: 45000, 45.000, 45,000, $45.000
export function parsearMonto(valor) {
  if (!valor && valor !== 0) return 0
  const str = String(valor).replace(/\$/g, '').replace(/\./g, '').replace(/,/g, '').trim()
  const n = parseInt(str)
  return isNaN(n) ? 0 : n
}

// Formatea número a string con puntos de miles estilo chileno: 45.000
export function formatearMonto(numero) {
  if (!numero && numero !== 0) return ''
  return Math.round(numero).toLocaleString('es-CL')
}

// Formatea con signo pesos: $45.000
export function formatearMontoConSimbolo(numero) {
  if (!numero && numero !== 0) return '$0'
  return '$' + formatearMonto(numero)
}
