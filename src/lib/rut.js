// Limpia el RUT dejando solo dígitos y K
export function limpiarRut(rut) {
  return rut.replace(/[.\-\s]/g, '').toUpperCase()
}

// Calcula el dígito verificador
export function calcularDv(rutNum) {
  let suma = 0, mul = 2
  const str = String(rutNum).split('').reverse()
  for (const c of str) {
    suma += parseInt(c) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const res = 11 - (suma % 11)
  if (res === 11) return '0'
  if (res === 10) return 'K'
  return String(res)
}

// Parsea el RUT en { num, dv } o null si no es válido estructuralmente
export function parsearRut(rut) {
  const clean = limpiarRut(rut)
  if (clean.length < 2) return null
  const dv = clean.slice(-1)
  const num = clean.slice(0, -1).replace(/\D/g, '')
  if (!num || num.length < 6) return null
  return { num: parseInt(num), dv }
}

// Formatea el RUT al formato correcto xx.xxx.xxx-x
export function formatearRut(rut) {
  const parsed = parsearRut(rut)
  if (!parsed) return rut
  const { num, dv } = parsed
  const s = String(num)
  let formatted
  if (s.length <= 3) {
    formatted = s
  } else if (s.length <= 6) {
    formatted = s.slice(0, -3) + '.' + s.slice(-3)
  } else if (s.length <= 9) {
    formatted = s.slice(0, -6) + '.' + s.slice(-6, -3) + '.' + s.slice(-3)
  } else {
    formatted = s.slice(0, -9) + '.' + s.slice(-9, -6) + '.' + s.slice(-6, -3) + '.' + s.slice(-3)
  }
  return formatted + '-' + dv
}

// Valida el RUT completo — retorna { valido, error, formateado }
export function validarRut(rut) {
  if (!rut || rut.trim() === '') {
    return { valido: false, error: 'El RUT es obligatorio', formateado: '' }
  }
  const parsed = parsearRut(rut)
  if (!parsed) {
    return { valido: false, error: 'Formato inválido — prueba: 12345678-9', formateado: '' }
  }
  const dvEsperado = calcularDv(parsed.num)
  if (parsed.dv !== dvEsperado) {
    return {
      valido: false,
      error: `Dígito verificador incorrecto — para ese RUT debería ser "${dvEsperado}"`,
      formateado: '',
    }
  }
  return { valido: true, error: '', formateado: formatearRut(rut) }
}
