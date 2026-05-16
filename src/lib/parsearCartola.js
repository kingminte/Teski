// ============================================================
// Detecta el tipo de archivo: 'cartola' o 'ultimos_movimientos'
// ============================================================
export function detectarTipoArchivo(nombreArchivo, rows) {
  const nombre = (nombreArchivo || '').toLowerCase()
  if (nombre.includes('ultimos') || nombre.includes('últimos') || nombre.includes('ultimo')) {
    return 'ultimos_movimientos'
  }
  // Revisar cabecera del archivo
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i]
    if (!row) continue
    const r0 = String(row[0] || '').toLowerCase()
    if (r0.includes('últimos movimientos') || r0.includes('ultimos movimientos')) return 'ultimos_movimientos'
  }
  return 'cartola'
}

// ============================================================
// Parser de "Últimos movimientos" Santander
// Formato: Fecha | Detalle | Monto cargo | Monto abono | Saldo
// ============================================================
export function parsearUltimosMovimientos(rows) {
  const movimientos = []
  let enDatos = false

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    const r0 = String(row[0] || '').trim()
    const r1 = String(row[1] || '').trim()

    // Detectar fila de encabezado: "Fecha | Detalle | Monto cargo..."
    if (r0.toLowerCase() === 'fecha' && r1.toLowerCase().includes('detalle')) {
      enDatos = true
      continue
    }

    if (!enDatos) continue
    if (!r0) continue

    // Parsear fecha formato DD-MM-YYYY o DD/MM/YYYY
    const partesFecha = r0.split(/[-\/]/)
    if (partesFecha.length < 3) continue
    const dia = partesFecha[0].padStart(2, '0')
    const mes = partesFecha[1].padStart(2, '0')
    const anio = partesFecha[2].length === 2 ? '20' + partesFecha[2] : partesFecha[2]
    const fecha = `${anio}-${mes}-${dia}`

    const descripcion = r1
    const parsearMonto = (v) => {
      if (v === null || v === undefined || v === '' || v === 'None') return 0
      const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''))
      return isNaN(n) ? 0 : Math.abs(n)
    }

    const cargo = parsearMonto(row[2])
    const abono = parsearMonto(row[3])
    const saldo = parsearMonto(row[4])

    if (cargo === 0 && abono === 0 && row[2] === undefined && row[3] === undefined) continue

    const monto = abono > 0 ? Math.round(abono) : -Math.round(cargo)
    const tipo = monto > 0 ? 'abono' : 'cargo'
    const rutDetectado = tipo === 'abono' ? extraerRutDesdeDescripcion(descripcion) : null
    const nombreDetectado = tipo === 'abono' ? extraerNombreDesdeDescripcion(descripcion) : null

    movimientos.push({
      fecha,
      sucursal: '',
      descripcion,
      n_documento: `um-${fecha}-${Math.abs(monto)}`, // ID sintético para anti-duplicado
      monto,
      saldo: Math.round(saldo),
      tipo,
      estado: tipo === 'cargo' ? 'gasto' : 'pendiente',
      rut_detectado: rutDetectado,
      nombre_detectado: nombreDetectado,
    })
  }

  return movimientos
}

// Extrae cabecera de últimos movimientos
export function extraerCabeceraUltimosMovimientos(rows) {
  const info = { banco: 'Santander', titular: '', cuenta: '', saldoActual: 0, fechaActual: '' }
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i]
    if (!row) continue
    const r0 = String(row[0] || '').trim()
    const r1 = String(row[1] || '').trim()
    if (r0.includes('Cuenta Corriente') || r0.includes('cuenta corriente')) info.cuenta = r0
    if (r1.includes('Cuenta Corriente') || r1.includes('cuenta corriente')) info.cuenta = r1
  }
  return info
}

// Extrae el RUT del campo descripción de Santander
// Ej: "0140968684 Transf. SANDRA..." → "14.096.868-4"
export function extraerRutDesdeDescripcion(descripcion) {
  if (!descripcion) return null
  const match = descripcion.trim().match(/^(\d{7,10})/)
  if (!match) return null
  const numStr = match[1]
  // El último dígito es el DV
  const dv = numStr.slice(-1)
  const num = parseInt(numStr.slice(0, -1))
  if (isNaN(num) || num < 100000) return null
  return formatearRutDesdeNumero(num, dv)
}

function formatearRutDesdeNumero(num, dv) {
  const s = String(num)
  let formatted
  if (s.length <= 3) formatted = s
  else if (s.length <= 6) formatted = s.slice(0,-3) + '.' + s.slice(-3)
  else if (s.length <= 9) formatted = s.slice(0,-6) + '.' + s.slice(-6,-3) + '.' + s.slice(-3)
  else formatted = s.slice(0,-9) + '.' + s.slice(-9,-6) + '.' + s.slice(-6,-3) + '.' + s.slice(-3)
  return formatted + '-' + dv.toUpperCase()
}

// Extrae el nombre de la descripción
// Ej: "0140968684 Transf. SANDRA JOSETTE LUCKEHEIDE" → "SANDRA JOSETTE LUCKEHEIDE"
export function extraerNombreDesdeDescripcion(descripcion) {
  if (!descripcion) return ''
  // Quitar el número inicial y palabras clave como "Transf.", "DEP.", etc.
  return descripcion
    .replace(/^\d+\s*/, '')
    .replace(/^(transf\.?|dep\.?|deposito|transferencia)\s*/i, '')
    .trim()
}

// Parsea las filas de la hoja de Santander y retorna movimientos normalizados
export function parsearCartolaSantander(rows) {
  const movimientos = []
  let enDetalle = false

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    const primera = String(row[0] || '').trim()

    // Detectar inicio de sección "DETALLE DE MOVIMIENTOS"
    if (primera.toUpperCase().includes('DETALLE DE MOVIMIENTOS')) {
      enDetalle = true
      continue
    }

    // Detectar encabezado de columnas (FECHA SUCURSAL DESCRIPCIÓN...)
    if (enDetalle && primera.toUpperCase() === 'FECHA') continue

    // Detectar fin de sección
    if (enDetalle && primera.toUpperCase().includes('RESUMEN')) break
    if (enDetalle && primera === '' && String(row[1] || '').trim() === '') continue

    if (!enDetalle) continue

    // Parsear fecha (formato DD/MM o DD/MM/YYYY)
    const fechaStr = primera
    if (!fechaStr.match(/^\d{1,2}[\/\-]\d{1,2}/)) continue

    const partesFecha = fechaStr.split(/[\/\-]/)
    const anioActual = new Date().getFullYear()
    const dia = partesFecha[0].padStart(2, '0')
    const mes = partesFecha[1].padStart(2, '0')
    const anio = partesFecha[2] ? (partesFecha[2].length === 2 ? '20' + partesFecha[2] : partesFecha[2]) : String(anioActual)
    const fecha = `${anio}-${mes}-${dia}`

    const sucursal = String(row[1] || '').trim()
    const descripcion = String(row[2] || '').trim()
    const nDocumento = String(row[3] || '').trim()

    // Columnas 4 y 5: cargos y abonos
    const cargos = parseFloat(String(row[4] || '0').replace(/[.$\s]/g, '').replace(',', '.')) || 0
    const abonos = parseFloat(String(row[5] || '0').replace(/[.$\s]/g, '').replace(',', '.')) || 0
    const saldo = parseFloat(String(row[6] || '0').replace(/[.$\s]/g, '').replace(',', '.')) || 0

    if (cargos === 0 && abonos === 0) continue

    const monto = abonos > 0 ? Math.round(abonos) : -Math.round(cargos)
    const tipo = monto > 0 ? 'abono' : 'cargo'

    const rutDetectado = tipo === 'abono' ? extraerRutDesdeDescripcion(descripcion) : null
    const nombreDetectado = tipo === 'abono' ? extraerNombreDesdeDescripcion(descripcion) : null

    movimientos.push({
      fecha,
      sucursal,
      descripcion,
      n_documento: nDocumento,
      monto,
      saldo: Math.round(saldo),
      tipo,
      estado: tipo === 'cargo' ? 'gasto' : 'pendiente',
      rut_detectado: rutDetectado,
      nombre_detectado: nombreDetectado,
    })
  }

  return movimientos
}

export const MESES = {
  'enero':1,'febrero':2,'marzo':3,'abril':4,'mayo':5,'junio':6,
  'julio':7,'agosto':8,'septiembre':9,'octubre':10,'noviembre':11,'diciembre':12,
}

// Extrae info de cabecera de la cartola Santander
export function extraerCabeceraCartola(rows) {
  const info = { banco: 'Santander', titular: '', rut: '', periodo: '', cuenta: '', mes: null, anio: null }
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i]
    if (!row) continue
    const r0 = String(row[0] || '').trim()
    const r1 = String(row[1] || '').trim()
    if (r0 === 'Sr(a)') info.titular = r1
    if (r0 === 'Rut') info.rut = r1
    if (r1 === 'Desde') info.periodo = String(row[5] || '')
    if (r1 === 'N° Cuenta:') info.cuenta = String(row[5] || '')

    if (info.mes && info.anio) continue
    for (let col = 0; col < row.length; col++) {
      const celda = String(row[col] || '').trim()
      if (!celda) continue
      for (const [mesNombre, mesNum] of Object.entries(MESES)) {
        const match = celda.match(new RegExp(mesNombre + '\\s+(\\d{4})', 'i'))
        if (match) {
          info.mes = mesNum
          info.anio = parseInt(match[1])
          if (!info.periodo) info.periodo = celda
          break
        }
      }
      if (info.mes && info.anio) break
    }
  }
  return info
}

export function extraerMesAnioDeNombre(nombreArchivo) {
  const nombre = (nombreArchivo || '').toLowerCase()
  for (const [mesNombre, mesNum] of Object.entries(MESES)) {
    const match = nombre.match(new RegExp(mesNombre + '[\\s_-]*(\\d{4})', 'i'))
    if (match) return { mes: mesNum, anio: parseInt(match[1]) }
  }
  return { mes: null, anio: null }
}

// Extrae el resumen financiero del bloque "Información cuenta corriente"
// Retorna: { saldoInicial, otrosAbonos, otrosCargos, saldoFinal }
export function extraerResumenCartola(rows) {
  const resumen = { saldoInicial: 0, otrosAbonos: 0, otrosCargos: 0, saldoFinal: 0 }

  const parsear = (v) => {
    if (v === null || v === undefined || v === '') return 0
    return parseFloat(String(v).replace(/[$.\s]/g, '').replace(',', '.')) || 0
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    for (let col = 0; col < row.length; col++) {
      const celda = String(row[col] || '').trim().toLowerCase().replace(':', '')
      const val = parsear(row[col + 1])
      if (val <= 0) continue

      if (celda === 'saldo inicial') resumen.saldoInicial = Math.round(val)
      else if (celda === 'saldo final') resumen.saldoFinal = Math.round(val)
      else if (celda === 'otros abonos' || celda === 'total abonos') resumen.otrosAbonos = Math.round(val)
      // "Cheques:" en la cartola Santander es el total de cargos por cheques cobrados
      else if (celda === 'otros cargos' || celda === 'total cargos' || celda === 'cheques') resumen.otrosCargos = Math.round(val)
    }
  }

  return resumen
}
