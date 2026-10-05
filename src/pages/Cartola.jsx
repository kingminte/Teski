import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import { formatearMontoConSimbolo, parsearMonto, formatearMonto } from '../lib/montos'
import * as XLSX from 'xlsx'
import { parsearCartolaSantander, extraerCabeceraCartola, extraerResumenCartola, parsearUltimosMovimientos, extraerCabeceraUltimosMovimientos, detectarTipoArchivo, extraerMesAnioDeNombre, mesAnioDominante } from '../lib/parsearCartola'

const NOMBRES_MES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

const formatearPeriodoCartola = (cartola) => {
  if (!cartola) return ''
  if (cartola.mes && cartola.anio) {
    const tipo = cartola.tipo === 'ultimos_movimientos' ? ' (Movimientos)' : ''
    return `${NOMBRES_MES[cartola.mes]} ${cartola.anio}${tipo}`
  }
  return (cartola.nombre_archivo || '')
    .replace(/\.(xlsx|xls|csv)$/i, '')
    .replace(/_/g, ' ')
    .replace(/Cartola de cuenta Corriente\s*-?\s*/i, '')
    .trim()
}

export default function Cartola() {
  const { showToast, ToastComponent } = useToast()
  const { puedeEditar, user } = useAuth()
  const editable = puedeEditar('cartola')
  const esAdmin = user?.rol === 'admin'
  const nombreUsuario = user?.nombre || user?.username || 'usuario'
  const fileRef = useRef()
  const [cartolas, setCartolas] = useState([])
  const [movimientos, setMovimientos] = useState([])
  const [socios, setSocios] = useState([])
  const [periodos, setPeriodos] = useState([])
  const [chequesChequera, setChequesChequera] = useState([])
  const [planCuentas, setPlanCuentas] = useState([])
  const [rutAlias, setRutAlias] = useState([])
  const [cambiandoAlias, setCambiandoAlias] = useState({}) // { movId: true }
  const [pagosMovimientos, setPagosMovimientos] = useState([])
  const [otrosIngresosTodos, setOtrosIngresosTodos] = useState([])
  const [vinculandoCargo, setVinculandoCargo] = useState({}) // { movId: id del candidato elegido }
  // Pagos de Cuentas por Pagar que NO salieron por cheque (efectivo, transferencia,
  // otro): los giros por caja no tienen folio de chequera, así que sin esto un cargo
  // pagado en efectivo se queda sin ningún candidato para vincular.
  const [pagosCxP, setPagosCxP] = useState([])

  const normRut = (r) => r ? r.replace(/\s/g,'').replace(/\./g,'').toLowerCase() : ''
  const [selectedCartola, setSelectedCartola] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [filtro, setFiltro] = useState('todos')
  const [vista, setVista] = useState('movimientos')
  const [resumen, setResumen] = useState(null)
  const [conciliando, setConciliando] = useState({})
  const [pagosSinConciliar, setPagosSinConciliar] = useState([])
  const [pagosNoAplica, setPagosNoAplica] = useState([])   // conciliacion='no_aplica'
  const [verExcluidos, setVerExcluidos] = useState(false)
  const [marcarNoAplica, setMarcarNoAplica] = useState(null)  // pago en el modal
  const [motivoNoAplica, setMotivoNoAplica] = useState('')
  const [guardandoNoAplica, setGuardandoNoAplica] = useState(false)
  const [filtroPagosSC, setFiltroPagosSC] = useState('todos')
  const [periodoPagosSC, setPeriodoPagosSC] = useState('todos')
  const [otrosIngresosForm, setOtrosIngresosForm] = useState({})
  const [candidatos, setCandidatos] = useState([]) // ingresos manuales sin movimiento_id, normalizados
  const [calzando, setCalzando] = useState({}) // { movId: true } mientras corre el RPC
  // 3B — diálogo de desempate cuando un depósito-de-cheque tiene >1 cheque candidato
  const [selectorCheque, setSelectorCheque] = useState(null) // { mov, candidatos:[{...,dist}], preseleccion }

  // Carga todos los ingresos manuales aún no conciliados (sin movimiento_id) y los
  // normaliza a una forma común para el matcher: { tipo, id, monto, fecha, socio, concepto, detalle }.
  const loadCandidatos = async () => {
    const [{ data: pagos }, { data: cheques }, { data: otros }] = await Promise.all([
      supabase.from('pagos_cuota')
        .select('id, monto, fecha_pago, concepto, socio_id, cheque_id, conciliacion, socios(id,nombre,apellido,numero_socio,rut), periodos_cuota(anio)')
        .is('movimiento_id', null),
      // El criterio de candidatura es "sin movimiento", NO el estado. Además de los
      // 'por_depositar', entran los 'depositado' que siguen sin movimiento_id: el
      // cheque cuyo depósito llega en la cartola del mes siguiente, y el rescatado
      // de un descalce. Solo 'anulado' queda fuera.
      supabase.from('cheques')
        .select('id, numero, monto, fecha_deposito, fecha_documento, concepto, concepto_descripcion, socio_id, estado, socios(id,nombre,apellido,numero_socio,rut)')
        .is('movimiento_id', null).in('estado', ['por_depositar', 'depositado']),
      supabase.from('otros_ingresos')
        .select('id, monto, fecha, concepto, descripcion')
        .is('movimiento_id', null),
    ])
    const norm = []
    // Cheques ya referenciados por un pago de cuota: se calzan vía el pago (el RPC
    // propaga el movimiento al cheque), así que no deben aparecer como candidato aparte.
    // Se calcula sobre TODOS los pagos sin movimiento, incluidos los 'no_aplica':
    // si no, el cheque de un pago excluido reaparecería como candidato suelto.
    const chequesDePago = new Set((pagos || []).map(p => p.cheque_id).filter(Boolean))
    ;(pagos || []).filter(p => p.conciliacion !== 'no_aplica').forEach(p => norm.push({
      tipo: 'pagos_cuota', id: p.id, monto: p.monto, fecha: p.fecha_pago,
      socio: p.socios, concepto: p.concepto || 'Cuota',
      detalle: p.periodos_cuota?.anio ? `Pago cuota ${p.periodos_cuota.anio}` : 'Pago de cuota',
    }))
    ;(cheques || []).forEach(c => {
      if (chequesDePago.has(c.id)) return
      // El RPC bloquea cheques con concepto 'cuota' (se calzan desde el flujo de cuotas).
      if ((c.concepto || '').toLowerCase().includes('cuota')) return
      norm.push({
        tipo: 'cheque', id: c.id, monto: c.monto, fecha: c.fecha_deposito || c.fecha_documento,
        socio: c.socios, concepto: c.concepto || 'Cheque',
        detalle: `Cheque N° ${c.numero}${c.concepto_descripcion ? ' · ' + c.concepto_descripcion : ''}`,
      })
    })
    ;(otros || []).forEach(o => norm.push({
      tipo: 'otros_ingresos', id: o.id, monto: o.monto, fecha: o.fecha,
      socio: null, concepto: o.concepto || 'Otros ingresos',
      detalle: o.descripcion || '',
    }))
    setCandidatos(norm)
  }

  // Un pago marcado 'no_aplica' nunca va a aparecer en cartola (canje, saldo de
  // apertura, cartola que el banco ya no entrega): sale de la operación de
  // conciliación, pero sigue sumando normalmente en los reportes.
  const loadPagosSinConciliar = async () => {
    const { data } = await supabase
      .from('pagos_cuota')
      .select('*, socios(nombre,apellido,numero_socio), periodos_cuota(anio), cheques(numero,estado)')
      .is('movimiento_id', null)
      .order('fecha_pago', { ascending: false })
    const todos = data || []
    setPagosSinConciliar(todos.filter(p => p.conciliacion !== 'no_aplica'))
    setPagosNoAplica(todos.filter(p => p.conciliacion === 'no_aplica'))
  }

  // ── Conciliación no aplica: marcar / revertir ──────────────
  const abrirNoAplica = (pago) => { setMarcarNoAplica(pago); setMotivoNoAplica('') }

  const handleMarcarNoAplica = async () => {
    const pago = marcarNoAplica
    const motivo = motivoNoAplica.trim()
    if (!motivo) { showToast('El motivo es obligatorio: queda como respaldo de por qué este pago no se concilia', 'error'); return }
    setGuardandoNoAplica(true)
    // El motivo se agrega al comentario, nunca lo reemplaza.
    const traza = `Conciliación no aplica — ${motivo} (${nombreUsuario}, ${new Date().toLocaleDateString('es-CL')})`
    const { error } = await supabase.from('pagos_cuota').update({
      conciliacion: 'no_aplica',
      comentario: pago.comentario ? `${pago.comentario}\n${traza}` : traza,
    }).eq('id', pago.id)
    setGuardandoNoAplica(false)
    if (error) { showToast('Error al marcar: ' + error.message, 'error'); return }
    showToast('Pago excluido de la conciliación')
    setMarcarNoAplica(null)
    loadPagosSinConciliar()
    loadCandidatos()
  }

  const handleRevertirNoAplica = async (pago) => {
    if (!confirm(`¿Devolver este pago a la conciliación?\n\n${pago.socios ? `${pago.socios.nombre} ${pago.socios.apellido}` : 'Socio'} · ${formatearMontoConSimbolo(pago.monto)} del ${pago.fecha_pago?.split('-').reverse().join('/')}\n\nVolverá a aparecer como pendiente y como candidato de calce.`)) return
    const traza = `Conciliación reactivada por ${nombreUsuario} el ${new Date().toLocaleDateString('es-CL')}`
    const { error } = await supabase.from('pagos_cuota').update({
      conciliacion: null,
      comentario: pago.comentario ? `${pago.comentario}\n${traza}` : traza,
    }).eq('id', pago.id)
    if (error) { showToast('Error al revertir: ' + error.message, 'error'); return }
    showToast('Pago devuelto a la conciliación')
    loadPagosSinConciliar()
    loadCandidatos()
  }

  // Pagos de Cuentas por Pagar pagados por una vía distinta al cheque. Se cargan
  // todos (conciliados o no): los sin movimiento_id alimentan el selector de
  // candidatos, y los ya vinculados alimentan el chip del cargo conciliado.
  const loadPagosCxP = async () => {
    const { data } = await supabase.from('pagos_cuenta')
      .select('id, monto, fecha_pago, medio_pago, movimiento_id, cuenta_id, cuentas_por_pagar(numero, concepto, proveedores(nombre))')
      .neq('medio_pago', 'cheque')
      .order('fecha_pago', { ascending: false })
    setPagosCxP(data || [])
  }

  useEffect(() => {
    loadCartolas()
    loadPagosSinConciliar()
    loadCandidatos()
    loadPagosCxP()
    supabase.from('socios').select('id,nombre,apellido,rut,numero_socio').order('numero_socio').then(({ data }) => setSocios(data || []))
    supabase.from('periodos_cuota').select('*').order('anio', { ascending: false }).then(({ data }) => setPeriodos(data || []))
    // Cheques EMITIDOS desde chequera (Control chequera)
    supabase.from('chequera_detalle').select('id,folio,monto,concepto,estado,beneficiario,fecha').order('folio').then(({ data }) => setChequesChequera(data || []))
    supabase.from('plan_cuentas').select('id,nombre,tipo').eq('activo', true).order('nombre').then(({ data }) => setPlanCuentas(data || []))
    supabase.from('rut_alias').select('rut,socio_id,nombre_detectado').then(({ data }) => setRutAlias(data || []))
  }, [])

  useEffect(() => {
    if (!selectedCartola) { setResumen(null); return }
    setResumen({
      saldoInicial: selectedCartola.saldo_inicial || 0,
      otrosAbonos: selectedCartola.total_abonos || 0,
      otrosCargos: selectedCartola.total_cargos || 0,
      saldoFinal: selectedCartola.saldo_final || 0,
    })
  }, [selectedCartola])

  const loadCartolas = async () => {
    const { data } = await supabase.from('cartolas').select('*')
    const ordenadas = (data || []).slice().sort((a, b) => {
      const ayear = a.anio ?? 0, byear = b.anio ?? 0
      if (ayear !== byear) return ayear - byear
      const amonth = a.mes ?? 0, bmonth = b.mes ?? 0
      if (amonth !== bmonth) return amonth - bmonth
      return new Date(a.created_at) - new Date(b.created_at)
    })
    setCartolas(ordenadas)
    if (ordenadas.length > 0) {
      const masNueva = ordenadas[ordenadas.length - 1]
      setSelectedCartola(masNueva)
      loadMovimientos(masNueva.id)
    }
  }

  const loadMovimientos = async (cartolaId) => {
    const { data } = await supabase
      .from('movimientos')
      .select('*, socios(nombre,apellido,numero_socio)')
      .eq('cartola_id', cartolaId)
      .order('fecha', { ascending: false })
    setMovimientos(data || [])

    const movIds = (data || []).filter(m => m.estado === 'conciliado').map(m => m.id)
    if (movIds.length > 0) {
      const [{ data: pagos }, { data: otros }] = await Promise.all([
        supabase.from('pagos_cuota').select('*, periodos_cuota(anio)').in('movimiento_id', movIds),
        supabase.from('otros_ingresos').select('*').in('movimiento_id', movIds),
      ])
      setPagosMovimientos(pagos || [])
      setOtrosIngresosTodos(otros || [])
    } else {
      setPagosMovimientos([])
      setOtrosIngresosTodos([])
    }
  }

  const getPagosDelMovimiento = (movId) => pagosMovimientos.filter(p => p.movimiento_id === movId)
  const getOtroIngresoDe = (movId) => otrosIngresosTodos.find(o => o.movimiento_id === movId)

  // Distancia en días entre dos fechas 'YYYY-MM-DD'. Date.UTC (no new Date) evita
  // el bug de timezone chileno. Sin fecha en alguno de los dos lados → Infinity,
  // así el candidato sin fecha queda último al desempatar por cercanía.
  const distanciaDias = (a, b) => {
    if (!a || !b) return Infinity
    const t = (f) => { const [y, m, d] = f.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000 }
    return Math.abs(t(a) - t(b))
  }

  // Puntúa un candidato contra un movimiento de abono. El RPC exige monto exacto,
  // así que un monto distinto descarta el candidato (devuelve null). Sobre esa base
  // se suman puntos por cercanía de fecha y por coincidencia de socio (id, RUT o nombre).
  // Devuelve también `dist` (días de separación) para poder desempatar por cercanía.
  const scoreCandidato = (mov, cand) => {
    if (cand.monto !== Math.abs(mov.monto)) return null
    let score = 50
    const razones = ['Monto exacto']
    const dist = distanciaDias(cand.fecha, mov.fecha)

    if (cand.fecha && mov.fecha) {
      const dias = dist
      if (dias <= 1) { score += 30; razones.push('Misma fecha') }
      else if (dias <= 3) { score += 20; razones.push('±3 días') }
      else if (dias <= 7) { score += 12; razones.push('±7 días') }
      else if (dias <= 30) { score += 4 }
    }

    if (cand.socio) {
      if (mov.socio_id && cand.socio.id === mov.socio_id) {
        score += 35; razones.push('Socio del calce')
      } else {
        const rutMov = normRut(mov.rut_detectado), rutCand = normRut(cand.socio.rut)
        if (rutMov && rutCand && rutMov === rutCand) {
          score += 35; razones.push('RUT coincide')
        } else {
          const nombreMov = (mov.nombre_detectado || '').toLowerCase()
          const apellido = (cand.socio.apellido || '').toLowerCase()
          const nombre = (cand.socio.nombre || '').toLowerCase()
          if (nombreMov && apellido && nombreMov.includes(apellido)) { score += 15; razones.push('Apellido similar') }
          else if (nombreMov && nombre && nombreMov.includes(nombre)) { score += 8; razones.push('Nombre similar') }
        }
      }
    }
    return { score, razones, dist }
  }

  // Top-5 candidatos calzables para un movimiento. Orden: score descendente y, a
  // igual score, por cercanía de fecha ascendente — un cheque fechado a 7 meses no
  // puede aparecer al mismo nivel que uno de la semana (ambos suman 0 por fecha).
  const getSugerencias = (mov) => candidatos
    .map(cand => { const s = scoreCandidato(mov, cand); return s ? { ...cand, ...s } : null })
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || (a.dist - b.dist))
    .slice(0, 5)

  // Etiqueta corta por tipo de ingreso (para el chip de la sugerencia).
  const tipoIngresoLabel = (tipo) =>
    tipo === 'pagos_cuota' ? 'Cuota' : tipo === 'cheque' ? 'Cheque' : 'Otros ingresos'

  const conceptoColor = (concepto) => {
    const c = (concepto || '').toLowerCase()
    if (c.includes('incorporación') || c.includes('incorporacion')) return { background: 'rgba(239,159,39,0.15)', color: '#fac775' }
    if (c.includes('cuota')) return { background: 'rgba(55,138,221,0.15)', color: '#85b7eb' }
    return { background: 'rgba(175,169,236,0.15)', color: '#afa9ec' }
  }

  const parseFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        // defval: null asegura que las celdas vacías aparezcan como null en vez de omitirse
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
        resolve(rows)
      } catch (err) { reject(err) }
    }
    reader.readAsBinaryString(file)
  })

  const handleFile = async (file) => {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['xls','xlsx','csv'].includes(ext)) { showToast('Formato no soportado', 'error'); return }
    setUploading(true)
    try {
      const rows = await parseFile(file)

      // 1. Detectar tipo de archivo
      const tipoArchivo = detectarTipoArchivo(file.name, rows)
      const esUltimosMovimientos = tipoArchivo === 'ultimos_movimientos'

      // 2. Parsear según tipo
      let movs, cabecera, resumenData
      if (esUltimosMovimientos) {
        movs = parsearUltimosMovimientos(rows)
        cabecera = extraerCabeceraUltimosMovimientos(rows)
        resumenData = null // No tiene resumen de cuenta corriente
      } else {
        movs = parsearCartolaSantander(rows)
        cabecera = extraerCabeceraCartola(rows)
        resumenData = extraerResumenCartola(rows)
      }

      if (movs.length === 0) { showToast('No se encontraron movimientos. Verifica el formato.', 'error'); setUploading(false); return }

      // 3. Fechar la cartola ANTES de validar duplicados, para poder decir en el
      // mensaje de error qué período creyó detectar. Orden de preferencia:
      // cabecera del Excel → nombre del archivo → mes dominante de los propios
      // movimientos. Nunca el mes actual: antes, si ninguna fuente daba el mes,
      // se estampaba el mes de hoy en `periodo` y mes/anio quedaban en null.
      const dominante = mesAnioDominante(movs)
      let mes = cabecera.mes
      let anio = cabecera.anio
      let origenPeriodo = (mes && anio) ? 'cabecera del archivo' : null

      if (!mes || !anio) {
        const deNombre = extraerMesAnioDeNombre(file.name)
        if (deNombre.mes && deNombre.anio) {
          mes = deNombre.mes
          anio = deNombre.anio
          origenPeriodo = 'nombre del archivo'
        }
      }
      if (!mes || !anio) {
        if (dominante.mes && dominante.anio) {
          mes = dominante.mes
          anio = dominante.anio
          origenPeriodo = 'fechas de los movimientos'
        }
      }
      // Conservador: si ninguna fuente lo determina, no se inventa un período.
      if (!mes || !anio) {
        showToast('No se pudo determinar el mes de la cartola (ni en la cabecera, ni en el nombre del archivo, ni en las fechas de los movimientos). Renombra el archivo incluyendo el mes y el año, por ejemplo "Cartola Septiembre 2023.xlsx".', 'error')
        setUploading(false)
        return
      }

      const periodoDetectado = `${NOMBRES_MES[mes]} ${anio}`
      const fechasOrdenadas = movs.map(m => m.fecha).filter(Boolean).sort()
      const rangoArchivo = fechasOrdenadas.length
        ? `${fechasOrdenadas[0].split('-').reverse().join('/')} a ${fechasOrdenadas[fechasOrdenadas.length - 1].split('-').reverse().join('/')}`
        : '—'
      // Contexto común a los dos mensajes de duplicado: sin esto no se podía
      // saber qué período había detectado el sistema al rechazar el archivo.
      const ctx = `Detectado: ${periodoDetectado} (según ${origenPeriodo}). El archivo trae ${movs.length} movimientos del ${rangoArchivo}.`

      // 4. Duplicado por nombre de archivo
      const { data: existente } = await supabase.from('cartolas').select('id, mes, anio').eq('nombre_archivo', file.name).maybeSingle()
      if (existente) {
        const perExistente = existente.mes && existente.anio ? ` (${NOMBRES_MES[existente.mes]} ${existente.anio})` : ''
        showToast(`La cartola "${file.name}"${perExistente} ya fue cargada anteriormente. ${ctx}`, 'error')
        setUploading(false)
        return
      }

      // 5. Duplicado de movimientos (solo cartola mensual con n_doc real).
      //
      // La llave es (n_documento + fecha + monto), no n_documento solo. El N° de
      // documento de Santander NO identifica un movimiento: es un número de
      // lote que se repite. Y el mismo documento puede tener cargos legítimos en
      // fechas distintas — un cheque protestado y re-presentado al mes siguiente
      // genera dos cargos reales con el mismo folio. Con la llave vieja ese
      // archivo quedaba bloqueado entero.
      //
      // La comparación sigue siendo global (sin acotar período) a propósito: con
      // la llave triple, una coincidencia exacta ES un duplicado real sin
      // importar de qué mes venga, así que acotar solo abriría la puerta a
      // re-subir una cartola antigua.
      if (!esUltimosMovimientos) {
        const conDoc = movs.filter(m => m.n_documento)
        const nDocs = conDoc.map(m => m.n_documento)
        if (nDocs.length > 0) {
          const claveMov = (d, f, mt) => `${d}|${f}|${mt}`
          // Se traen los candidatos por n_documento (es lo indexable) y la
          // coincidencia exacta de los tres campos se decide acá.
          const { data: candidatos } = await supabase.from('movimientos')
            .select('n_documento, fecha, monto').in('n_documento', nDocs)
          const yaCargados = new Set((candidatos || []).map(d => claveMov(d.n_documento, d.fecha, d.monto)))
          const choques = conDoc.filter(m => yaCargados.has(claveMov(m.n_documento, m.fecha, m.monto)))

          if (choques.length > 0) {
            const dupes = choques
              .slice(0, 6)
              .map(m => `${m.n_documento} del ${m.fecha.split('-').reverse().join('/')} por ${formatearMontoConSimbolo(Math.abs(m.monto))}`)
              .join(', ')
            const mas = choques.length > 6 ? ` y ${choques.length - 6} más` : ''
            showToast(`${choques.length} movimiento(s) ya registrado(s): ${dupes}${mas}. ${ctx}`, 'error')
            setUploading(false)
            return
          }
        }
      }

      // Aviso no bloqueante: el archivo abarca más de un mes. Es la causa típica
      // de un choque de N° de documento con un mes vecino ya cargado.
      if (dominante.meses.length > 1) {
        const detalle = dominante.meses.map(x => `${x.periodo} (${x.movimientos})`).join(', ')
        showToast(`Atención: el archivo abarca varios meses — ${detalle}. Se guardará como ${periodoDetectado}.`, 'error')
      }

      // 6. Cruzar con socios por RUT (directo o vía alias aprendido)
      const movsConCalce = movs.map(m => {
        if (!m.rut_detectado) return m
        const rutMov = normRut(m.rut_detectado)
        const socio = socios.find(s => normRut(s.rut) === rutMov)
        if (socio) return { ...m, socio_id: socio.id, estado: 'pendiente' }
        const alias = rutAlias.find(a => normRut(a.rut) === rutMov)
        if (alias) return { ...m, socio_id: alias.socio_id, estado: 'pendiente' }
        return m
      })

      // 7. Calcular resumen financiero
      let resumenCartola
      if (resumenData) {
        resumenCartola = {
          saldo_inicial: resumenData.saldoInicial || 0,
          saldo_final: resumenData.saldoFinal || 0,
          total_abonos: resumenData.otrosAbonos || 0,
          total_cargos: resumenData.otrosCargos || 0,
        }
      } else {
        const abonosSum = movsConCalce.filter(m => m.monto > 0).reduce((t, m) => t + m.monto, 0)
        const cargosSum = Math.abs(movsConCalce.filter(m => m.monto < 0).reduce((t, m) => t + m.monto, 0))
        resumenCartola = {
          saldo_inicial: 0,
          saldo_final: movsConCalce[0]?.saldo || 0,
          total_abonos: abonosSum,
          total_cargos: cargosSum,
        }
      }

      // 8. Crear cartola. mes/anio ya quedaron resueltos en el paso 3 y son
      // obligatorios: acá no se vuelve a adivinar nada.
      const periodo = `${anio}-${String(mes).padStart(2, '0')}`
      const { data: cartola, error } = await supabase.from('cartolas')
        .insert({
          nombre_archivo: file.name,
          periodo,
          mes,
          anio,
          total_movimientos: movsConCalce.length,
          banco: cabecera.banco || 'Santander',
          tipo: tipoArchivo,
          ...resumenCartola,
        })
        .select().single()
      if (error) throw new Error('Error creando cartola: ' + error.message)

      // 9. Insertar movimientos
      const toInsert = movsConCalce.map(m => ({ ...m, cartola_id: cartola.id }))
      const { error: mErr } = await supabase.from('movimientos').insert(toInsert)
      if (mErr) throw new Error('Error guardando movimientos: ' + mErr.message)

      const conCalce = movsConCalce.filter(m => m.socio_id).length
      showToast(`${esUltimosMovimientos ? 'Últimos movimientos' : 'Cartola'} cargada: ${movsConCalce.length} movimientos, ${conCalce} con calce automático`)
      loadCartolas()
      setVista('conciliacion')
    } catch (err) {
      console.error('ERROR en handleFile:', err)
      showToast('Error al cargar: ' + (err?.message || 'desconocido'), 'error')
    }
    setUploading(false)
  }

  // Estado de conciliación de un movimiento
  const getConciliando = (movId) => conciliando[movId] || { abierto: false, lineas: [], confirmado: false }

  const getLineasIniciales = (mov) => [{
    id: Date.now(),
    periodoId: periodos[0]?.id || '',
    concepto: 'Cuota social',
    monto: formatearMonto(Math.abs(mov.monto)),
  }]

  const agregarLinea = (movId) => {
    setConciliando(prev => {
      const c = prev[movId] || { abierto: true, lineas: [], confirmado: false }
      return {
        ...prev,
        [movId]: {
          ...c,
          lineas: [...c.lineas, { id: Date.now() + Math.random(), periodoId: periodos[0]?.id || '', concepto: 'Cuota social', monto: '' }],
        }
      }
    })
  }

  const quitarLinea = (movId, lineaId) => {
    setConciliando(prev => {
      const c = prev[movId]
      if (!c || c.lineas.length <= 1) return prev
      return { ...prev, [movId]: { ...c, lineas: c.lineas.filter(l => l.id !== lineaId) } }
    })
  }

  const actualizarLinea = (movId, lineaId, campo, valor) => {
    setConciliando(prev => {
      const c = prev[movId]
      if (!c) return prev
      return {
        ...prev,
        [movId]: { ...c, lineas: c.lineas.map(l => l.id === lineaId ? { ...l, [campo]: valor } : l) }
      }
    })
  }

  const calcularDistribucion = (lineas, montoTotal) => {
    const distribuido = lineas.reduce((t, l) => t + (parsearMonto(l.monto) || 0), 0)
    const restante = montoTotal - distribuido
    return { distribuido, restante, completo: restante === 0, excede: restante < 0 }
  }

  const toggleForm = (movId) => {
    const mov = movimientos.find(m => m.id === movId)
    setConciliando(prev => {
      const c = prev[movId]
      if (c?.abierto) return { ...prev, [movId]: { ...c, abierto: false } }
      return {
        ...prev,
        [movId]: { abierto: true, confirmado: false, lineas: c?.lineas?.length ? c.lineas : getLineasIniciales(mov) }
      }
    })
  }

  // 3B — GUARD: el auto-amarre de cheque SOLO aplica a depósitos de cheque, NO a
  // transferencias. Los depósitos de cheque llegan como "Depósito Documento …" sin
  // rut_detectado; las transferencias traen rut_detectado + "… Transf. NOMBRE".
  const esDepositoDeCheque = (mov) =>
    !mov.rut_detectado && /dep[óo]sito\s+documento/i.test(mov.descripcion || '')

  // Cheques candidatos para auto-amarre: del socio, monto exacto, ya depositados y
  // aún sin movimiento. (Query directa a cheques; no pasa por loadCandidatos/getSugerencias,
  // que sirven al matcher general y excluyen cheques de cuota.)
  const buscarChequesDepositados = async (socioId, monto) => {
    if (!socioId) return []
    const { data } = await supabase.from('cheques')
      .select('id, numero, monto, estado, fecha_deposito, fecha_documento, socio_id, concepto, movimiento_id')
      .eq('socio_id', socioId).eq('monto', monto)
      .eq('estado', 'depositado').is('movimiento_id', null)
    return data || []
  }

  // ────────────────────────────────────────────────────────────
  // Vínculo cheque ↔ movimiento: SIEMPRE en espejo
  // ────────────────────────────────────────────────────────────
  // El vínculo vive en dos columnas que deben moverse juntas:
  //   cheques.movimiento_id  ↔  movimientos.cheque_id
  // Escribir un solo lado deja el otro mintiendo: el movimiento sigue "Sin calce"
  // aunque el cheque ya esté amarrado, o el cheque queda 'depositado' apuntando a
  // un movimiento que ya se descalzó. Las tres funciones de abajo son el único
  // camino permitido para tocar ese vínculo desde la cartola.

  // GUARD contra doble amarre. Relee el movimiento en la DB (no confía en el estado
  // de React, que puede venir de una carga anterior a que otro usuario/pestaña
  // calzara) y devuelve un mensaje de error si ya está tomado.
  const verificarMovimientoLibre = async (movId) => {
    const { data: fresco, error } = await supabase.from('movimientos')
      .select('id, estado, cheque_id').eq('id', movId).maybeSingle()
    if (error) return 'No se pudo verificar el movimiento: ' + error.message
    if (!fresco) return 'El movimiento ya no existe — refresca la cartola'
    if (fresco.cheque_id) {
      const { data: ch } = await supabase.from('cheques')
        .select('numero').eq('id', fresco.cheque_id).maybeSingle()
      return `Este movimiento ya está conciliado con el cheque N° ${ch?.numero ?? fresco.cheque_id}`
    }
    if (fresco.estado === 'conciliado') return 'Este movimiento ya está conciliado — refresca la cartola'
    return null
  }

  // CALZAR — escribe los dos lados como una sola operación.
  // 1) cheques: antes de pisar fecha_deposito con la fecha de la cartola, respalda
  //    la fecha original en fecha_documento si estaba vacía (así el descalce puede
  //    devolverla, y quedan cubiertos los cheques antiguos sin fecha_documento).
  // 2) movimientos: el espejo (cheque_id) + estado y montos conciliados.
  // Si (2) falla, (1) se revierte con un update compensatorio: nunca un solo lado.
  // `extraMovimiento` permite sumar campos al update del movimiento (p. ej. socio_id)
  // sin partir la escritura en dos y perder la compensación.
  const escribirCalceCheque = async (mov, cheque, extraMovimiento = {}) => {
    const ahora = new Date().toISOString() // timestamp de auditoría (no es fecha de display)

    // 1) Cheque → movimiento.
    const updCheque = {
      estado: 'depositado',
      movimiento_id: mov.id,
      conciliado_en: ahora,
      conciliado_por: user?.id || null,
      fecha_deposito: mov.fecha,
    }
    if (!cheque.fecha_documento) updCheque.fecha_documento = cheque.fecha_deposito
    // `.is('movimiento_id', null)` es el candado optimista: si otro proceso lo amarró
    // entremedio, el update no afecta filas y abortamos antes de tocar el movimiento.
    const { data: filas, error: e1 } = await supabase.from('cheques')
      .update(updCheque).eq('id', cheque.id).is('movimiento_id', null).select('id')
    if (e1) throw new Error('Error al amarrar el cheque: ' + e1.message)
    if (!filas || filas.length === 0) throw new Error(`El cheque N° ${cheque.numero} ya fue amarrado a otro movimiento — refresca la cartola`)

    // 2) Movimiento → cheque (el espejo).
    const { error: e2 } = await supabase.from('movimientos').update({
      cheque_id: cheque.id,
      estado: 'conciliado',
      monto_conciliado: cheque.monto,
      monto_pendiente: 0,
      ...extraMovimiento,
    }).eq('id', mov.id)

    if (e2) {
      // Compensación: deshacer el paso 1 con los valores previos del cheque.
      await supabase.from('cheques').update({
        estado: cheque.estado,
        movimiento_id: null,
        conciliado_en: null,
        conciliado_por: null,
        fecha_deposito: cheque.fecha_deposito,
        fecha_documento: cheque.fecha_documento,
      }).eq('id', cheque.id)
      throw new Error('Error al conciliar el movimiento (se revirtió el cheque): ' + e2.message)
    }
  }

  // DESCALZAR — revierte los dos lados. Espejo exacto de escribirCalceCheque:
  // el cheque vuelve a 'por_depositar' sin vínculo y recupera su fecha original
  // desde fecha_documento; el movimiento vuelve a pendiente con su monto libre.
  const escribirDescalceCheque = async (mov, cheque) => {
    const updCheque = {
      // Un cheque anulado no revive al descalzar: pierde el vínculo, no el estado.
      estado: cheque.estado === 'anulado' ? 'anulado' : 'por_depositar',
      movimiento_id: null,
      conciliado_en: null,
      conciliado_por: null,
    }
    // Si fecha_documento es null no hay fecha original que devolver: dejamos
    // fecha_deposito como está en vez de borrarla.
    if (cheque.fecha_documento) updCheque.fecha_deposito = cheque.fecha_documento

    const { error: e1 } = await supabase.from('cheques').update(updCheque).eq('id', cheque.id)
    if (e1) throw new Error('Error al liberar el cheque: ' + e1.message)

    // socio_id vuelve a null igual que en el desconciliar normal: así el movimiento
    // reaparece en "Sin calce" y no arrastra el socio que le puso el calce anterior.
    const { error: e2 } = await supabase.from('movimientos').update({
      cheque_id: null,
      estado: 'pendiente',
      socio_id: null,
      monto_conciliado: 0,
      monto_pendiente: Math.abs(mov.monto),
    }).eq('id', mov.id)

    if (e2) {
      // Compensación: volver a dejar el cheque como estaba amarrado.
      await supabase.from('cheques').update({
        estado: cheque.estado,
        movimiento_id: cheque.movimiento_id,
        conciliado_en: cheque.conciliado_en,
        conciliado_por: cheque.conciliado_por,
        fecha_deposito: cheque.fecha_deposito,
      }).eq('id', cheque.id)
      throw new Error('Error al descalzar el movimiento (se revirtió el cheque): ' + e2.message)
    }
  }

  // Cheque amarrado a un movimiento. Consulta por cheques.movimiento_id (el lado
  // que sí se escribía históricamente), así que también encuentra los vínculos
  // antiguos en que movimientos.cheque_id quedó null.
  const buscarChequeDelMovimiento = async (movId) => {
    const { data } = await supabase.from('cheques')
      .select('id, numero, monto, estado, movimiento_id, fecha_deposito, fecha_documento, conciliado_en, conciliado_por')
      .eq('movimiento_id', movId)
    return data || []
  }

  // Amarra un cheque depositado a un movimiento, igual que el backfill de la etapa 2:
  // idempotente y sin crear pagos extra. El vínculo cheque ↔ movimiento lo escribe
  // escribirCalceCheque (los dos lados o ninguno); acá sólo se le suma el pago.
  const amarrarChequeAMovimiento = async (mov, cheque) => {
    const ahora = new Date().toISOString() // timestamp de auditoría (no es fecha de display)
    try {
      // Idempotente: si ya está amarrado a este movimiento, no repetir.
      if (cheque.movimiento_id === mov.id) { setSelectorCheque(null); return true }
      if (cheque.movimiento_id) { showToast('Ese cheque ya está amarrado a otro movimiento', 'error'); return false }

      // GUARD doble amarre: releer el movimiento antes de escribir nada.
      const ocupadoPor = await verificarMovimientoLibre(mov.id)
      if (ocupadoPor) {
        showToast(ocupadoPor, 'error')
        setSelectorCheque(null)
        loadMovimientos(selectedCartola.id)
        return false
      }

      // 1) Vínculo completo: cheque + movimiento en espejo.
      await escribirCalceCheque(mov, cheque, { socio_id: mov.socio_id || cheque.socio_id })

      // 2) Ligar el pago EXISTENTE de ESE cheque (sin movimiento). No crea pagos.
      const { data: pagosLigados, error: e2 } = await supabase.from('pagos_cuota')
        .update({ movimiento_id: mov.id, conciliado_en: ahora, conciliado_por: user?.id || null })
        .eq('cheque_id', cheque.id).is('movimiento_id', null).select('id')
      // El calce ya quedó completo y consistente; lo que falla acá es sólo el pago.
      if (e2) throw new Error('Cheque y movimiento calzados, pero falló ligar el pago: ' + e2.message)

      // 3) Si el cheque no tenía pago, crear uno ligado a cheque + movimiento (concepto
      //    null = cuenta como cuota). Idempotente: solo si no existe ya uno para este mov.
      if (!pagosLigados || pagosLigados.length === 0) {
        const { data: yaExiste } = await supabase.from('pagos_cuota')
          .select('id').eq('cheque_id', cheque.id).eq('movimiento_id', mov.id)
        if (!yaExiste || yaExiste.length === 0) {
          const { error: e3 } = await supabase.from('pagos_cuota').insert({
            socio_id: cheque.socio_id, periodo_id: null, monto: cheque.monto,
            fecha_pago: mov.fecha, forma_pago: 'cheque', movimiento_id: mov.id,
            cheque_id: cheque.id, concepto: null,
            comentario: `Cheque depositado amarrado desde cartola — ${mov.descripcion}`,
            conciliado_en: ahora, conciliado_por: user?.id || null,
          })
          if (e3) throw new Error('Error al crear el pago del cheque: ' + e3.message)
        }
      }

      setConciliando(prev => { const n = { ...prev }; delete n[mov.id]; return n })
      setSelectorCheque(null)
      showToast(`Cheque N°${cheque.numero} amarrado al depósito (sin crear pago nuevo)`)
      loadMovimientos(selectedCartola.id)
      loadCandidatos()
      loadPagosSinConciliar()
      return true
    } catch (err) {
      showToast(err.message, 'error')
      return false
    }
  }

  const handleConfirmarCalce = async (mov) => {
    const c = conciliando[mov.id]
    if (!c?.lineas?.length) return

    const montoTotal = Math.abs(mov.monto)

    // 3B — Auto-amarre de cheque depositado (SOLO caso simple: un socio, 1 línea, y el
    // movimiento es un depósito de cheque). Multi-línea (3D) y "por depositar" (3C) NO entran.
    if (c.lineas.length === 1 && mov.socio_id && esDepositoDeCheque(mov)) {
      const cands = await buscarChequesDepositados(mov.socio_id, montoTotal)
      if (cands.length === 1) {
        await amarrarChequeAMovimiento(mov, cands[0])
        return
      }
      if (cands.length > 1) {
        const cd = cands
          .map(ch => ({ ...ch, dist: distanciaDias(ch.fecha_deposito, mov.fecha) }))
          .sort((a, b) => a.dist - b.dist)
        const empate = cd.length > 1 && cd[0].dist === cd[1].dist
        setSelectorCheque({ mov, candidatos: cd, preseleccion: empate ? null : cd[0].id })
        return
      }
      // 0 candidatos → no es un cheque a amarrar; sigue el flujo normal.
    }

    const { distribuido, restante, completo, excede } = calcularDistribucion(c.lineas, montoTotal)

    if (!completo) {
      if (excede) showToast('La distribución supera el monto de la transferencia', 'error')
      else showToast(`Falta distribuir ${formatearMontoConSimbolo(restante)}. Agrega otra línea o ajusta los montos.`, 'error')
      return
    }

    try {
      for (const linea of c.lineas) {
        const montoLinea = parsearMonto(linea.monto)
        if (montoLinea <= 0) continue
        const { error } = await supabase.from('pagos_cuota').insert({
          socio_id: mov.socio_id,
          periodo_id: linea.periodoId || null,
          monto: montoLinea,
          fecha_pago: mov.fecha,
          forma_pago: 'transferencia',
          movimiento_id: mov.id,
          concepto: linea.concepto || null,
          comentario: `Conciliado desde cartola — ${mov.descripcion}`,
        })
        if (error) throw new Error('Error registrando pago: ' + error.message)
      }

      await supabase.from('movimientos').update({
        estado: 'conciliado',
        socio_id: mov.socio_id || null,
        monto_conciliado: distribuido,
        monto_pendiente: 0,
      }).eq('id', mov.id)

      setConciliando(prev => ({ ...prev, [mov.id]: { ...c, confirmado: true, abierto: false } }))
      showToast(`Calce confirmado — ${c.lineas.length} pago(s) registrado(s)`)
      loadMovimientos(selectedCartola.id)
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  const handleAsignarSocio = async (movId, socioId) => {
    const mov = movimientos.find(m => m.id === movId)
    await supabase.from('movimientos').update({ socio_id: socioId || null, estado: 'pendiente' }).eq('id', movId)
    setCambiandoAlias(prev => { const n = { ...prev }; delete n[movId]; return n })

    if (socioId && mov?.rut_detectado) {
      const rutNorm = normRut(mov.rut_detectado)
      const esSocioRegistrado = socios.some(s => normRut(s.rut) === rutNorm)
      if (!esSocioRegistrado) {
        const aliasRow = { rut: mov.rut_detectado, socio_id: socioId, nombre_detectado: mov.nombre_detectado || '' }
        const { error } = await supabase.from('rut_alias').upsert(aliasRow, { onConflict: 'rut' })
        if (!error) {
          setRutAlias(prev => [...prev.filter(a => a.rut !== mov.rut_detectado), aliasRow])
          showToast('Socio asignado. Este RUT se recordará para futuras cartolas.')
        }
      }
    }
    loadMovimientos(selectedCartola.id)
  }

  const [recalculandoSaldos, setRecalculandoSaldos] = useState(false)

  const handleRecalcularSaldos = async () => {
    if (!confirm('Recalcular saldo_inicial y saldo_final de todas las cartolas a partir de sus movimientos. ¿Continuar?')) return
    setRecalculandoSaldos(true)
    try {
      const { data: cartolasTodas } = await supabase.from('cartolas').select('id, mes, anio, nombre_archivo')
      let actualizadas = 0
      for (const c of (cartolasTodas || [])) {
        const { data: movsAsc } = await supabase.from('movimientos').select('fecha,monto,saldo').eq('cartola_id', c.id).order('fecha', { ascending: true })
        if (!movsAsc || movsAsc.length === 0) continue
        const primero = movsAsc[0]
        const ultimo = movsAsc[movsAsc.length - 1]
        const saldoFinal = ultimo.saldo || 0
        // saldo_inicial = saldo del primer movimiento menos su movimiento neto
        const saldoInicial = (primero.saldo || 0) - (primero.monto || 0)
        await supabase.from('cartolas').update({ saldo_inicial: saldoInicial, saldo_final: saldoFinal }).eq('id', c.id)
        actualizadas++
      }
      showToast(`Saldos recalculados en ${actualizadas} cartola(s)`)
      loadCartolas()
    } catch (e) {
      showToast('Error: ' + e.message, 'error')
    }
    setRecalculandoSaldos(false)
  }

  const handleEliminarCartola = async () => {
    if (!selectedCartola) return
    const nombre = selectedCartola.nombre_archivo
    if (!confirm(`¿Eliminar la cartola "${nombre}"?\n\nSe borrarán también todos los movimientos asociados. Esta acción no se puede deshacer.`)) return
    const { error } = await supabase.from('cartolas').delete().eq('id', selectedCartola.id)
    if (error) { showToast('Error al eliminar la cartola: ' + error.message, 'error'); return }
    showToast(`Cartola "${nombre}" eliminada`)
    setSelectedCartola(null)
    setMovimientos([])
    setResumen(null)
    loadCartolas()
  }

  const handleVincularCargo = async (movId, chequeId) => {
    if (!chequeId) return
    try {
      const { error: e1 } = await supabase.from('movimientos').update({
        estado: 'conciliado',
        chequera_detalle_id: chequeId,
      }).eq('id', movId)
      if (e1) { showToast('Error al vincular movimiento: ' + e1.message, 'error'); return }

      const { error: e2 } = await supabase.from('chequera_detalle').update({ estado: 'cobrado' }).eq('id', chequeId)
      if (e2) { showToast('Error al actualizar cheque: ' + e2.message, 'error'); return }

      showToast('Egreso vinculado al cheque correctamente')
      loadMovimientos(selectedCartola.id)
      setVinculandoCargo(prev => { const n = {...prev}; delete n[movId]; return n })
      supabase.from('chequera_detalle').select('id,folio,monto,concepto,estado,beneficiario,fecha').order('folio').then(({ data }) => setChequesChequera(data || []))
    } catch (e) {
      showToast('Error al vincular: ' + e.message, 'error')
    }
  }

  const toggleOtrosIngresos = (movId) => {
    setOtrosIngresosForm(prev => ({
      ...prev,
      [movId]: prev[movId]?.abierto
        ? { ...prev[movId], abierto: false }
        : { concepto: '', descripcion: '', abierto: true }
    }))
  }

  const handleConfirmarOtrosIngresos = async (mov) => {
    const form = otrosIngresosForm[mov.id]
    if (!form?.concepto) { showToast('Selecciona un concepto', 'error'); return }
    try {
      let storagePath = null
      let nombreArchivo = null
      if (form.archivo) {
        const path = `otros_ingresos/${mov.id}/${Date.now()}_${form.archivo.name}`
        const { error: upErr } = await supabase.storage.from('cartolas').upload(path, form.archivo)
        if (upErr) {
          console.error('Error subiendo archivo:', upErr)
          showToast('Aviso: ingreso registrado, pero no se pudo subir el archivo', 'error')
        } else {
          storagePath = path
          nombreArchivo = form.archivo.name
        }
      }

      const { error: e1 } = await supabase.from('otros_ingresos').insert({
        movimiento_id: mov.id,
        concepto: form.concepto,
        descripcion: form.descripcion || mov.descripcion,
        monto: mov.monto,
        fecha: mov.fecha,
        storage_path: storagePath,
        nombre_archivo: nombreArchivo,
      })
      if (e1) throw new Error(e1.message)
      const { error: e2 } = await supabase.from('movimientos').update({ estado: 'conciliado' }).eq('id', mov.id)
      if (e2) throw new Error(e2.message)
      showToast(`Registrado como otros ingresos: ${form.concepto}`)
      setOtrosIngresosForm(prev => { const n = { ...prev }; delete n[mov.id]; return n })
      loadMovimientos(selectedCartola.id)
    } catch (e) {
      showToast('Error: ' + e.message, 'error')
    }
  }

  const handleDesconciliar = async (mov) => {
    // Buscar el cheque ANTES de confirmar: si hay uno amarrado, el aviso tiene que
    // decir que también se libera (y con qué fecha vuelve).
    const chequesAmarrados = await buscarChequeDelMovimiento(mov.id)
    const aviso = chequesAmarrados.length > 0
      ? `¿Desconciliar este movimiento? Se eliminarán los pagos de cuota y otros ingresos asociados, el cheque N° ${chequesAmarrados.map(c => c.numero).join(', N° ')} volverá a 'Por depositar' con su fecha original, y el movimiento volverá a estado pendiente.`
      : '¿Desconciliar este movimiento? Se eliminarán los pagos de cuota y otros ingresos asociados, y el movimiento volverá a estado pendiente.'
    if (!confirm(aviso)) return
    try {
      const { error: ePago } = await supabase.from('pagos_cuota').delete().eq('movimiento_id', mov.id)
      if (ePago) throw new Error(ePago.message)

      const { error: eOtros } = await supabase.from('otros_ingresos').delete().eq('movimiento_id', mov.id)
      if (eOtros) throw new Error(eOtros.message)

      // Cheque amarrado: revertir los dos lados juntos (cheque + movimiento). Sin
      // esto el cheque queda 'depositado' apuntando a un movimiento ya descalzado,
      // invisible como candidato y con la fecha de la cartola en vez de la suya.
      if (chequesAmarrados.length > 0) {
        for (const ch of chequesAmarrados) await escribirDescalceCheque(mov, ch)
        setConciliando(prev => { const n = { ...prev }; delete n[mov.id]; return n })
        showToast(`Movimiento desconciliado — cheque N° ${chequesAmarrados.map(c => c.numero).join(', N° ')} liberado`)
        loadMovimientos(selectedCartola.id)
        loadCandidatos()
        loadPagosSinConciliar()
        return
      }

      const { error: eMov } = await supabase.from('movimientos').update({
        estado: 'pendiente',
        socio_id: null,
        cheque_id: null,
        monto_conciliado: 0,
        monto_pendiente: 0,
      }).eq('id', mov.id)
      if (eMov) throw new Error(eMov.message)

      setConciliando(prev => { const n = { ...prev }; delete n[mov.id]; return n })
      showToast('Movimiento desconciliado correctamente')
      loadMovimientos(selectedCartola.id)
      loadCandidatos()
    } catch (e) {
      showToast('Error al desconciliar: ' + e.message, 'error')
    }
  }

  // ────────────────────────────────────────────────────────────
  // Cargo ↔ pago de Cuentas por Pagar (giros que no salieron por cheque)
  // ────────────────────────────────────────────────────────────
  // Mismo patrón espejo que el vínculo cheque ↔ movimiento: las dos filas se
  // escriben juntas o ninguna. Aquí el vínculo vive en pagos_cuenta.movimiento_id
  // y en el estado/montos del movimiento.

  // Etiqueta del pago CxP, tal como se muestra en el selector y en el chip.
  const etiquetaPagoCxP = (p) => {
    const cuenta = p.cuentas_por_pagar
    const numero = String(cuenta?.numero ?? '').padStart(3, '0')
    const proveedor = cuenta?.proveedores?.nombre || cuenta?.concepto || '—'
    return `Pago CxP N°${numero} — ${proveedor}`
  }

  // Candidatos para un cargo: pagos CxP sin conciliar y de monto exacto. El monto
  // del cargo viene negativo en la cartola; el del pago es positivo.
  // Los pagos por canje quedan fuera: saldan la cuenta con servicios, nunca van
  // a tener un cargo bancario que calzar.
  const candidatosPagoCxP = (mov) =>
    pagosCxP.filter(p => !p.movimiento_id && p.medio_pago !== 'canje' && p.monto === Math.abs(mov.monto))

  const pagoCxPDe = (movId) => pagosCxP.find(p => p.movimiento_id === movId)

  const handleVincularPagoCxP = async (mov, pagoId) => {
    const pago = pagosCxP.find(p => p.id === pagoId)
    if (!pago) { showToast('Pago no encontrado — recarga la página', 'error'); return }
    try {
      // GUARD: releer el movimiento antes de escribir. La lista en memoria puede
      // ser anterior a que otro usuario/pestaña lo vinculara.
      const { data: fresco, error: eFresco } = await supabase.from('movimientos')
        .select('id, estado').eq('id', mov.id).maybeSingle()
      if (eFresco) { showToast('No se pudo verificar el movimiento: ' + eFresco.message, 'error'); return }
      if (!fresco) { showToast('El movimiento ya no existe — recarga la página', 'error'); return }
      if (fresco.estado === 'conciliado') {
        showToast('Este movimiento ya está conciliado — recarga la página', 'error')
        loadMovimientos(selectedCartola.id)
        return
      }

      // 1) Pago CxP → movimiento. `.is('movimiento_id', null)` es el candado
      //    optimista: si otro proceso lo tomó entremedio, no afecta filas.
      const { data: filas, error: e1 } = await supabase.from('pagos_cuenta')
        .update({ movimiento_id: mov.id }).eq('id', pago.id).is('movimiento_id', null).select('id')
      if (e1) throw new Error('Error al vincular el pago: ' + e1.message)
      if (!filas || filas.length === 0) throw new Error('Ese pago ya fue vinculado a otro movimiento — recarga la página')

      // 2) Movimiento → conciliado. Si falla, se revierte el paso 1.
      const { error: e2 } = await supabase.from('movimientos').update({
        estado: 'conciliado',
        monto_conciliado: pago.monto,
        monto_pendiente: 0,
      }).eq('id', mov.id)
      if (e2) {
        await supabase.from('pagos_cuenta').update({ movimiento_id: null }).eq('id', pago.id)
        throw new Error('Error al conciliar el movimiento (se revirtió el pago): ' + e2.message)
      }

      showToast(`Egreso vinculado a ${etiquetaPagoCxP(pago)}`)
      setVinculandoCargo(prev => { const n = { ...prev }; delete n[mov.id]; return n })
      loadMovimientos(selectedCartola.id)
      loadPagosCxP()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const handleDesvincularPagoCxP = async (mov, pago) => {
    if (!confirm(`¿Desvincular este egreso de ${etiquetaPagoCxP(pago)}? El pago volverá a quedar sin conciliar.`)) return
    try {
      // 1) Soltar el pago.
      const { error: e1 } = await supabase.from('pagos_cuenta')
        .update({ movimiento_id: null }).eq('id', pago.id)
      if (e1) throw new Error('Error al soltar el pago: ' + e1.message)

      // 2) Movimiento de vuelta a libre. 'gasto' es el estado de un cargo sin
      //    vincular en toda la app (lo pone parsearCartola al importar, y es el
      //    que restaura el desvincular de cheques). Si falla, se revierte el paso 1.
      const { error: e2 } = await supabase.from('movimientos').update({
        estado: 'gasto',
        monto_conciliado: 0,
        monto_pendiente: Math.abs(mov.monto),
      }).eq('id', mov.id)
      if (e2) {
        await supabase.from('pagos_cuenta').update({ movimiento_id: mov.id }).eq('id', pago.id)
        throw new Error('Error al liberar el movimiento (se revirtió el pago): ' + e2.message)
      }

      showToast('Egreso desvinculado correctamente')
      loadMovimientos(selectedCartola.id)
      loadPagosCxP()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const handleDesvincularCargo = async (mov) => {
    if (!confirm('¿Desvincular este egreso del cheque? El cheque volverá a estado emitido.')) return
    try {
      if (mov.chequera_detalle_id) {
        const { error: eCheque } = await supabase.from('chequera_detalle').update({ estado: 'emitido' }).eq('id', mov.chequera_detalle_id)
        if (eCheque) throw new Error(eCheque.message)
      }

      const { error: eMov } = await supabase.from('movimientos').update({
        estado: 'gasto',
        chequera_detalle_id: null,
      }).eq('id', mov.id)
      if (eMov) throw new Error(eMov.message)

      showToast('Egreso desvinculado correctamente')
      loadMovimientos(selectedCartola.id)
      supabase.from('chequera_detalle').select('id,folio,monto,concepto,estado,beneficiario,fecha').order('folio').then(({ data }) => setChequesChequera(data || []))
    } catch (e) {
      showToast('Error al desvincular: ' + e.message, 'error')
    }
  }

  // Calza un movimiento de abono con un ingreso manual sugerido. Toda la operación
  // (marcar el ingreso, propagar cheque, marcar el movimiento) corre en el RPC dentro
  // de una sola transacción.
  const handleCalzarSugerencia = async (mov, cand) => {
    setCalzando(prev => ({ ...prev, [mov.id]: true }))
    try {
      // GUARD doble amarre: releer el movimiento. El RPC ya rechaza el estado
      // 'conciliado', pero acá el mensaje puede nombrar el cheque que lo ocupa.
      const ocupadoPor = await verificarMovimientoLibre(mov.id)
      if (ocupadoPor) {
        showToast(ocupadoPor, 'error')
        loadMovimientos(selectedCartola.id)
        setCalzando(prev => { const n = { ...prev }; delete n[mov.id]; return n })
        return
      }

      // El RPC pisa fecha_deposito con la fecha de la cartola. Respaldar antes la
      // fecha original en fecha_documento si estaba vacía, para que el descalce
      // pueda devolverla. Idempotente: si ya tiene fecha_documento, no se toca.
      if (cand.tipo === 'cheque') {
        const { data: ch } = await supabase.from('cheques')
          .select('fecha_deposito, fecha_documento').eq('id', cand.id).maybeSingle()
        if (ch && !ch.fecha_documento && ch.fecha_deposito) {
          await supabase.from('cheques')
            .update({ fecha_documento: ch.fecha_deposito }).eq('id', cand.id)
        }
      }

      const { error } = await supabase.rpc('calzar_movimiento_con_ingreso', {
        p_movimiento_id: mov.id,
        p_tipo_ingreso: cand.tipo,
        p_ingreso_id: cand.id,
        p_usuario_id: user?.id || null,
      })
      if (error) throw new Error(error.message)

      // Espejo del vínculo: el RPC amarra cheques.movimiento_id; acá se cierra el
      // otro lado. `.is('cheque_id', null)` lo hace idempotente y compatible con la
      // versión del RPC que ya escribe cheque_id por su cuenta.
      if (cand.tipo === 'cheque') {
        const { error: eEspejo } = await supabase.from('movimientos')
          .update({ cheque_id: cand.id }).eq('id', mov.id).is('cheque_id', null)
        if (eEspejo) throw new Error('Calce hecho, pero no se pudo enlazar el movimiento al cheque: ' + eEspejo.message)
      }

      showToast(`Movimiento calzado con ${tipoIngresoLabel(cand.tipo).toLowerCase()}`)
      loadMovimientos(selectedCartola.id)
      loadCandidatos()
      loadPagosSinConciliar()
    } catch (e) {
      showToast('Error al calzar: ' + e.message, 'error')
    }
    setCalzando(prev => { const n = { ...prev }; delete n[mov.id]; return n })
  }

  const handleIgnorarMovimiento = async (mov) => {
    if (!confirm('¿Marcar este movimiento como ignorado? No volverá a aparecer entre los pendientes de conciliación.')) return
    const { error } = await supabase.from('movimientos').update({ estado: 'ignorado' }).eq('id', mov.id)
    if (error) { showToast('Error al ignorar: ' + error.message, 'error'); return }
    showToast('Movimiento ignorado')
    loadMovimientos(selectedCartola.id)
  }

  const handleReactivarMovimiento = async (mov) => {
    const { error } = await supabase.from('movimientos').update({ estado: 'pendiente' }).eq('id', mov.id)
    if (error) { showToast('Error al reactivar: ' + error.message, 'error'); return }
    showToast('Movimiento reactivado')
    loadMovimientos(selectedCartola.id)
  }

  const abonos = movimientos.filter(m => m.tipo === 'abono')
  const conCalce = abonos.filter(m => m.socio_id)
  const confirmados = abonos.filter(m => m.estado === 'conciliado')
  const pendientes = conCalce.filter(m => m.estado !== 'conciliado' && m.estado !== 'ignorado')
  const sinCalce = abonos.filter(m => !m.socio_id && m.estado !== 'conciliado' && m.estado !== 'ignorado')
  const ignorados = abonos.filter(m => m.estado === 'ignorado')

  const filtrados = movimientos.filter(m => {
    if (filtro === 'abonos') return m.tipo === 'abono'
    if (filtro === 'pendientes') return m.tipo === 'abono' && m.estado !== 'conciliado' && m.estado !== 'ignorado'
    if (filtro === 'conciliados') return m.estado === 'conciliado'
    if (filtro === 'sin_calce') return m.tipo === 'abono' && !m.socio_id && m.estado !== 'conciliado' && m.estado !== 'ignorado'
    if (filtro === 'ignorados') return m.tipo === 'abono' && m.estado === 'ignorado'
    return true
  })

  return (
    <div>
      {ToastComponent}

      {/* Upload */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-upload"></i> Cargar cartola bancaria</div>
          {cartolas.length > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={`btn btn-sm${vista === 'movimientos' ? ' btn-primary' : ''}`} onClick={() => setVista('movimientos')}>
                <i className="ti ti-list"></i> Movimientos
              </button>
              <button className={`btn btn-sm${vista === 'conciliacion' ? ' btn-primary' : ''}`} onClick={() => setVista('conciliacion')}>
                <i className="ti ti-list-check"></i> Conciliación
              </button>
              <button className={`btn btn-sm${vista === 'sin_conciliar' ? ' btn-primary' : ''}`} onClick={() => { setVista('sin_conciliar'); loadPagosSinConciliar() }}>
                <i className="ti ti-alert-circle"></i> Sin conciliar ({pagosSinConciliar.length})
              </button>
            </div>
          )}
        </div>
        {editable && <div style={{ padding: '1.5rem' }}>
          <div
            className={`upload-zone${dragOver ? ' drag-over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
          >
            {uploading ? (
              <>
                <div style={{ fontSize: 48, color: 'var(--gold)', marginBottom: 12 }}><i className="ti ti-loader"></i></div>
                <div style={{ fontSize: 16, color: 'var(--gold-light)' }}>Procesando cartola…</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Detectando movimientos y cruzando RUTs con socios</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 48, color: 'var(--gold-dim)', marginBottom: 12 }}><i className="ti ti-file-spreadsheet"></i></div>
                <div style={{ fontSize: 16, color: 'var(--gold-light)', marginBottom: 6 }}>Arrastra tu cartola aquí</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Formato Santander — .xls, .xlsx</div>
                <button className="btn btn-primary" style={{ marginTop: '1.25rem', display: 'inline-flex' }}
                  onClick={e => { e.stopPropagation(); fileRef.current?.click() }}>
                  <i className="ti ti-upload"></i> Seleccionar archivo
                </button>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".xls,.xlsx,.csv" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
        </div>}
      </div>

      {/* Selector cartola */}
      {cartolas.length > 0 && selectedCartola && (
        <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Cartola:</span>
          {cartolas.length > 1 ? (
            <select value={selectedCartola?.id || ''} onChange={e => {
              const c = cartolas.find(c => c.id === e.target.value)
              setSelectedCartola(c); loadMovimientos(c.id)
            }} style={{ width: 'auto', fontSize: 13 }}>
              {cartolas.map(c => <option key={c.id} value={c.id}>{formatearPeriodoCartola(c)}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
              {formatearPeriodoCartola(selectedCartola)}
            </span>
          )}
          {editable && (
            <button className="btn btn-sm" onClick={handleRecalcularSaldos} disabled={recalculandoSaldos}
              title="Releer saldo_inicial y saldo_final de cada cartola desde sus movimientos">
              {recalculandoSaldos ? <><i className="ti ti-loader"></i> Recalculando…</> : <><i className="ti ti-refresh"></i> Recalcular saldos</>}
            </button>
          )}
          {editable && (
            <button className="btn btn-sm btn-danger" onClick={handleEliminarCartola} title="Eliminar cartola y sus movimientos">
              <i className="ti ti-trash"></i> Eliminar
            </button>
          )}
        </div>
      )}

      {/* VISTA CONCILIACIÓN */}
      {vista === 'conciliacion' && selectedCartola && (
        <>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: '1rem' }}>
            {[
              { label: 'Total abonos', value: formatearMontoConSimbolo(abonos.reduce((t,m) => t + m.monto, 0)), color: '#5dcaa5' },
              { label: 'Confirmados', value: confirmados.length, color: '#5dcaa5' },
              { label: 'Pendientes calce', value: pendientes.length, color: '#fac775' },
              { label: 'Sin calce', value: sinCalce.length, color: 'var(--text-muted)' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title"><i className="ti ti-list-check"></i> Conciliación manual — {formatearPeriodoCartola(selectedCartola)}</div>
            </div>

            {abonos.length === 0 ? (
              <div className="empty-state"><i className="ti ti-list-off"></i>Sin abonos en esta cartola</div>
            ) : (
              abonos.map(mov => {
                const c = getConciliando(mov.id)
                const socioCalce = socios.find(s => s.id === mov.socio_id)

                return (
                  <div key={mov.id} style={{ borderBottom: '0.5px solid rgba(201,168,76,0.08)', padding: '1rem 1.5rem' }}>
                    {/* Header del movimiento */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                            {mov.fecha.split('-').reverse().join('/')}
                          </span>
                          {mov.rut_detectado && (
                            <span style={{ fontFamily: 'monospace', fontSize: 11, background: 'rgba(201,168,76,0.1)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '1px 7px', color: 'var(--text-muted)' }}>
                              RUT: {mov.rut_detectado}
                            </span>
                          )}
                          {(() => {
                            const esAlias = socioCalce && mov.rut_detectado && normRut(socioCalce.rut) !== normRut(mov.rut_detectado)
                            if (mov.estado === 'conciliado') return <span className="badge badge-active"><i className="ti ti-check" style={{ fontSize: 10 }}></i> Conciliado</span>
                            if (!socioCalce) return <span className="badge badge-inactive">Sin calce</span>
                            if (esAlias) return (
                              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500, background: 'rgba(55,138,221,0.15)', color: '#85b7eb' }}>
                                <i className="ti ti-brain" style={{ fontSize: 11, marginRight: 4 }}></i>Calce aprendido
                              </span>
                            )
                            return <span className="badge badge-pending">Calce RUT</span>
                          })()}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{mov.descripcion}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 'bold', color: '#5dcaa5' }}>{formatearMontoConSimbolo(mov.monto)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>Doc N° {mov.n_documento || '—'}</div>
                      </div>
                    </div>

                    {/* Caja de calce */}
                    {mov.estado !== 'conciliado' && mov.estado !== 'ignorado' && (() => {
                      const esAlias = socioCalce && mov.rut_detectado && normRut(socioCalce.rut) !== normRut(mov.rut_detectado)
                      const mostrarSelect = !socioCalce || cambiandoAlias[mov.id]
                      const sugerencias = getSugerencias(mov)
                      const ocupado = !!calzando[mov.id]
                      return (
                      <>
                        {!mostrarSelect ? (
                          <div style={{ background: 'rgba(29,158,117,0.1)', border: '0.5px solid rgba(29,158,117,0.3)', borderRadius: 8, padding: '0.6rem 0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(55,138,221,0.2)', color: '#85b7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 'bold', flexShrink: 0 }}>
                                {socioCalce.nombre[0]}{socioCalce.apellido[0]}
                              </div>
                              <div>
                                <div style={{ fontSize: 13, color: '#c8d0dc' }}>{socioCalce.nombre} {socioCalce.apellido}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>{socioCalce.numero_socio} · {socioCalce.rut}</div>
                              </div>
                            </div>
                            {editable && (
                              <div style={{ display: 'flex', gap: 6 }}>
                                {esAlias && (
                                  <button className="btn btn-sm" style={{ fontSize: 11 }} title="Reasignar este RUT a otro socio"
                                    onClick={() => setCambiandoAlias(prev => ({ ...prev, [mov.id]: true }))}>
                                    <i className="ti ti-refresh"></i> Cambiar
                                  </button>
                                )}
                                <button className="btn btn-sm" style={{ color: '#afa9ec', borderColor: 'rgba(175,169,236,0.4)', fontSize: 11 }}
                                  onClick={() => toggleOtrosIngresos(mov.id)} title="Registrar como otros ingresos en lugar de pago de socio">
                                  <i className="ti ti-coin"></i> Otros ingresos
                                </button>
                                <button className="btn btn-sm" style={{ color: '#5dcaa5', borderColor: 'rgba(29,158,117,0.4)' }} onClick={() => toggleForm(mov.id)}>
                                  <i className={`ti ${c.abierto ? 'ti-chevron-up' : 'ti-adjustments'}`}></i>
                                  {c.abierto ? 'Cerrar' : 'Conciliar'}
                                </button>
                              </div>
                            )}
                          </div>
                        ) : editable ? (
                          <div style={{ background: 'rgba(201,168,76,0.06)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <i className="ti ti-alert-circle" style={{ fontSize: 14 }}></i>
                              {socioCalce
                                ? <>Reasignar RUT {mov.rut_detectado} — actualmente en {socioCalce.nombre} {socioCalce.apellido}</>
                                : <>RUT {mov.rut_detectado || 'no detectado'} — no encontrado en socios</>}
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <select
                                value={mov.socio_id || ''}
                                onChange={e => handleAsignarSocio(mov.id, e.target.value)}
                                style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }}
                              >
                                <option value="">Asignar socio manualmente…</option>
                                {socios.map(s => <option key={s.id} value={s.id}>{s.nombre} {s.apellido} ({s.numero_socio})</option>)}
                              </select>
                              {cambiandoAlias[mov.id] && (
                                <button className="btn btn-sm" title="Cancelar"
                                  onClick={() => setCambiandoAlias(prev => { const n = { ...prev }; delete n[mov.id]; return n })}>
                                  <i className="ti ti-x"></i>
                                </button>
                              )}
                              <button className="btn btn-sm" style={{ color: '#afa9ec', borderColor: 'rgba(175,169,236,0.4)' }}
                                onClick={() => toggleOtrosIngresos(mov.id)} title="Registrar como otros ingresos">
                                <i className="ti ti-coin"></i> Otros ingresos
                              </button>
                              <button className="btn btn-sm" onClick={() => toggleForm(mov.id)}>
                                <i className="ti ti-adjustments"></i>
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {/* Sugerencias de ingresos manuales que calzan con este movimiento */}
                        {editable && !c.abierto && !otrosIngresosForm[mov.id]?.abierto && sugerencias.length > 0 && (
                          <div style={{ background: 'rgba(55,138,221,0.06)', border: '0.5px solid rgba(55,138,221,0.3)', borderRadius: 8, padding: '0.75rem 0.9rem', marginBottom: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: '#85b7eb', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                              <i className="ti ti-wand" style={{ fontSize: 16 }}></i>
                              Ingresos manuales que calzan ({sugerencias.length})
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {sugerencias.map(sug => (
                                <div key={`${sug.tipo}-${sug.id}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'rgba(10,22,40,0.4)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '0.5rem 0.75rem' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                    <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 7px', borderRadius: 4, flexShrink: 0, ...conceptoColor(sug.concepto) }}>
                                      {tipoIngresoLabel(sug.tipo)}
                                    </span>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontSize: 12, color: '#c8d0dc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {sug.socio ? `${sug.socio.nombre} ${sug.socio.apellido}` : sug.concepto}
                                        {sug.fecha && <span style={{ color: 'var(--text-dim)', fontFamily: 'sans-serif' }}> · {sug.fecha.split('-').reverse().join('/')}</span>}
                                      </div>
                                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {sug.detalle || sug.concepto} · {sug.razones.join(' · ')}
                                      </div>
                                    </div>
                                  </div>
                                  <button className="btn btn-sm btn-primary" style={{ flexShrink: 0 }} disabled={ocupado}
                                    onClick={() => handleCalzarSugerencia(mov, sug)}>
                                    {ocupado ? <i className="ti ti-loader"></i> : <><i className="ti ti-link"></i> Calzar</>}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Ignorar este movimiento */}
                        {editable && !c.abierto && !otrosIngresosForm[mov.id]?.abierto && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                            <button className="btn btn-sm" style={{ color: 'var(--text-muted)', fontSize: 11 }}
                              onClick={() => handleIgnorarMovimiento(mov)}
                              title="Marcar como ignorado — no aparecerá entre los pendientes">
                              <i className="ti ti-eye-off"></i> Ignorar movimiento
                            </button>
                          </div>
                        )}

                        {/* Formulario de otros ingresos */}
                        {editable && otrosIngresosForm[mov.id]?.abierto && (
                          <div style={{ background: 'rgba(175,169,236,0.06)', border: '0.5px solid rgba(175,169,236,0.3)', borderRadius: 8, padding: '1rem', marginTop: 6 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: '#afa9ec', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                              <i className="ti ti-coin" style={{ fontSize: 16 }}></i> Registrar como otros ingresos
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                              <div>
                                <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 3, fontFamily: 'sans-serif' }}>Concepto *</label>
                                <select value={otrosIngresosForm[mov.id]?.concepto || ''}
                                  onChange={e => setOtrosIngresosForm(prev => ({ ...prev, [mov.id]: { ...prev[mov.id], concepto: e.target.value } }))}>
                                  <option value="">Seleccionar del plan de cuentas…</option>
                                  {planCuentas.filter(pc => pc.tipo === 'ingreso').map(pc => (
                                    <option key={pc.id} value={pc.nombre}>{pc.nombre}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 3, fontFamily: 'sans-serif' }}>Descripción (opcional)</label>
                                <input type="text" placeholder="Detalle del ingreso…" value={otrosIngresosForm[mov.id]?.descripcion || ''}
                                  onChange={e => setOtrosIngresosForm(prev => ({ ...prev, [mov.id]: { ...prev[mov.id], descripcion: e.target.value } }))} />
                              </div>
                            </div>
                            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                              <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif' }}>Respaldo</label>
                              <input
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png"
                                id={`file-otros-${mov.id}`}
                                style={{ display: 'none' }}
                                onChange={e => {
                                  const file = e.target.files[0]
                                  if (file) setOtrosIngresosForm(prev => ({ ...prev, [mov.id]: { ...prev[mov.id], archivo: file } }))
                                }}
                              />
                              {otrosIngresosForm[mov.id]?.archivo ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(175,169,236,0.1)', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontFamily: 'sans-serif' }}>
                                  <i className={`ti ${otrosIngresosForm[mov.id].archivo.name.toLowerCase().endsWith('.pdf') ? 'ti-file-type-pdf' : 'ti-photo'}`} style={{ fontSize: 14, color: '#afa9ec' }}></i>
                                  <span style={{ color: '#c8d0dc' }}>{otrosIngresosForm[mov.id].archivo.name}</span>
                                  <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: 0, display: 'flex' }}
                                    onClick={() => setOtrosIngresosForm(prev => ({ ...prev, [mov.id]: { ...prev[mov.id], archivo: null } }))}
                                    title="Quitar archivo">
                                    <i className="ti ti-x"></i>
                                  </button>
                                </div>
                              ) : (
                                <button className="btn btn-sm" style={{ color: '#afa9ec', borderColor: 'rgba(175,169,236,0.4)' }}
                                  onClick={() => document.getElementById(`file-otros-${mov.id}`).click()}>
                                  <i className="ti ti-paperclip"></i> Adjuntar archivo
                                </button>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                                Monto: <strong style={{ color: '#5dcaa5' }}>{formatearMontoConSimbolo(mov.monto)}</strong> · Fecha: {mov.fecha.split('-').reverse().join('/')}
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button className="btn btn-sm" onClick={() => toggleOtrosIngresos(mov.id)}>Cancelar</button>
                                <button className="btn btn-sm btn-primary" onClick={() => handleConfirmarOtrosIngresos(mov)} disabled={!otrosIngresosForm[mov.id]?.concepto}>
                                  <i className="ti ti-check"></i> Confirmar
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Formulario de distribución multi-concepto */}
                        {editable && c.abierto && (() => {
                          const montoTotal = Math.abs(mov.monto)
                          const { distribuido, restante, completo, excede } = calcularDistribucion(c.lineas, montoTotal)
                          return (
                            <div style={{ background: 'rgba(10,22,40,0.5)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem', marginTop: 4 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                <div style={{ fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <i className="ti ti-arrows-split" style={{ fontSize: 16, color: '#85b7eb' }}></i>
                                  Distribuir en múltiples conceptos
                                </div>
                                <button className="btn btn-sm" onClick={() => agregarLinea(mov.id)}>
                                  <i className="ti ti-plus"></i> Agregar línea
                                </button>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 32px', gap: 8, paddingBottom: 4 }}>
                                <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Período</label>
                                <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Concepto</label>
                                <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Monto ($)</label>
                                <label></label>
                              </div>

                              {c.lineas.map((linea, idx) => (
                                <div key={linea.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 32px', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: idx < c.lineas.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                                  <select value={linea.periodoId} onChange={e => actualizarLinea(mov.id, linea.id, 'periodoId', e.target.value)}>
                                    <option value="">Sin período</option>
                                    {periodos.map(p => <option key={p.id} value={p.id}>{p.anio} — {formatearMontoConSimbolo(p.monto)}</option>)}
                                  </select>
                                  <select value={linea.concepto} onChange={e => actualizarLinea(mov.id, linea.id, 'concepto', e.target.value)}>
                                    <option value="">Seleccionar…</option>
                                    {planCuentas.filter(pc => pc.tipo === 'ingreso').map(pc => (
                                      <option key={pc.id} value={pc.nombre}>{pc.nombre}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="text" inputMode="numeric"
                                    value={linea.monto}
                                    onChange={e => actualizarLinea(mov.id, linea.id, 'monto', e.target.value)}
                                    onBlur={() => { const n = parsearMonto(linea.monto); if (n > 0) actualizarLinea(mov.id, linea.id, 'monto', formatearMonto(n)) }}
                                    onFocus={() => { const n = parsearMonto(linea.monto); if (n > 0) actualizarLinea(mov.id, linea.id, 'monto', String(n)) }}
                                  />
                                  <button
                                    onClick={() => quitarLinea(mov.id, linea.id)}
                                    disabled={c.lineas.length <= 1}
                                    style={{ width: 28, height: 28, borderRadius: '50%', border: '0.5px solid var(--border)', background: 'transparent', color: c.lineas.length <= 1 ? 'var(--text-dim)' : 'var(--text-muted)', cursor: c.lineas.length <= 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}
                                    title="Quitar línea"
                                  >
                                    <i className="ti ti-x"></i>
                                  </button>
                                </div>
                              ))}

                              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, fontFamily: 'sans-serif' }}>
                                  <span style={{ color: 'var(--text-muted)' }}>Total transferencia: <strong>{formatearMontoConSimbolo(montoTotal)}</strong></span>
                                  <span style={{ color: completo ? '#5dcaa5' : excede ? '#f09595' : '#fac775' }}>
                                    Distribuido: <strong>{formatearMontoConSimbolo(distribuido)}</strong>
                                  </span>
                                  <span style={{ color: restante === 0 ? 'var(--text-muted)' : restante > 0 ? '#fac775' : '#f09595' }}>
                                    Restante: <strong>{formatearMontoConSimbolo(Math.abs(restante))}</strong>
                                  </span>
                                </div>
                                <div style={{ height: 6, background: 'rgba(201,168,76,0.15)', borderRadius: 3, overflow: 'hidden' }}>
                                  <div style={{ width: `${Math.min(100, Math.round((distribuido / montoTotal) * 100))}%`, height: '100%', borderRadius: 3, background: completo ? '#5dcaa5' : excede ? '#f09595' : '#fac775', transition: 'width 0.3s' }}></div>
                                </div>
                                <div style={{ fontSize: 11, marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, color: completo ? '#5dcaa5' : excede ? '#f09595' : '#fac775', fontFamily: 'sans-serif' }}>
                                  {completo && <><i className="ti ti-check"></i> Monto completamente distribuido — listo para confirmar</>}
                                  {!completo && !excede && <><i className="ti ti-alert-circle"></i> Falta distribuir {formatearMontoConSimbolo(restante)} — agrega otra línea o ajusta montos</>}
                                  {excede && <><i className="ti ti-alert-triangle"></i> La distribución supera el monto en {formatearMontoConSimbolo(Math.abs(restante))}</>}
                                </div>
                              </div>

                              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, paddingTop: 10, borderTop: '0.5px solid var(--border)' }}>
                                <button className="btn btn-sm" onClick={() => setConciliando(prev => ({ ...prev, [mov.id]: { ...c, abierto: false } }))}>Cancelar</button>
                                <button className="btn btn-primary btn-sm" onClick={() => handleConfirmarCalce(mov)} disabled={!completo}>
                                  <i className="ti ti-check"></i> Confirmar calce
                                </button>
                              </div>
                            </div>
                          )
                        })()}
                      </>
                      )
                    })()}

                    {/* Ignorado */}
                    {mov.estado === 'ignorado' && (
                      <div style={{ background: 'rgba(127,140,158,0.1)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.9rem', fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <i className="ti ti-eye-off" style={{ fontSize: 16 }}></i>
                          Movimiento ignorado · <strong>{formatearMontoConSimbolo(mov.monto)}</strong>
                        </div>
                        {editable && (
                          <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => handleReactivarMovimiento(mov)}>
                            <i className="ti ti-arrow-back-up"></i> Reactivar
                          </button>
                        )}
                      </div>
                    )}

                    {/* Conciliado */}
                    {mov.estado === 'conciliado' && !mov.socio_id && (() => {
                      const otroIngreso = getOtroIngresoDe(mov.id)
                      return (
                      <div style={{ background: 'rgba(175,169,236,0.1)', border: '0.5px solid rgba(175,169,236,0.3)', borderRadius: 8, padding: '0.6rem 0.9rem', fontSize: 12, color: '#afa9ec', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <i className="ti ti-coin" style={{ fontSize: 16 }}></i>
                          Otros ingresos
                          {otroIngreso?.concepto && <span style={{ color: '#c8d0dc' }}>· {otroIngreso.concepto}</span>}
                          <span>· <strong>{formatearMontoConSimbolo(mov.monto)}</strong></span>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {otroIngreso?.nombre_archivo && (
                            <button className="btn btn-sm" style={{ color: '#afa9ec', borderColor: 'rgba(175,169,236,0.4)', fontSize: 11 }}
                              onClick={async () => {
                                const { data } = await supabase.storage.from('cartolas').createSignedUrl(otroIngreso.storage_path, 300)
                                if (data?.signedUrl) window.open(data.signedUrl, '_blank')
                                else showToast('Error al obtener el archivo', 'error')
                              }}
                              title={otroIngreso.nombre_archivo}>
                              <i className="ti ti-eye"></i> Ver respaldo
                            </button>
                          )}
                          {editable && (
                            <button className="btn btn-sm" style={{ color: '#f09595', borderColor: 'rgba(240,149,149,0.4)', fontSize: 11 }}
                              onClick={() => handleDesconciliar(mov)}>
                              <i className="ti ti-arrow-back-up"></i> Desconciliar
                            </button>
                          )}
                        </div>
                      </div>
                      )
                    })()}

                    {mov.estado === 'conciliado' && mov.socio_id && (() => {
                      const pagosDelMov = getPagosDelMovimiento(mov.id)
                      const tieneMultiples = pagosDelMov.length > 1
                      return (
                        <div style={{ background: 'rgba(29,158,117,0.1)', border: '0.5px solid rgba(29,158,117,0.3)', borderRadius: 8, padding: '0.6rem 0.9rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: tieneMultiples ? 6 : 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#5dcaa5', flexWrap: 'wrap' }}>
                              <i className="ti ti-circle-check" style={{ fontSize: 16 }}></i>
                              {!tieneMultiples ? (
                                <span>
                                  {formatearMontoConSimbolo(mov.monto_conciliado || mov.monto)} aplicado
                                  {mov.socios && <strong> — {mov.socios.nombre} {mov.socios.apellido} ({mov.socios.numero_socio})</strong>}
                                  {pagosDelMov.length === 1 && pagosDelMov[0].concepto && (
                                    <span style={{ ...conceptoColor(pagosDelMov[0].concepto), display: 'inline-flex', padding: '1px 7px', borderRadius: 4, fontSize: 10, fontWeight: 500, marginLeft: 6 }}>
                                      {pagosDelMov[0].concepto}{pagosDelMov[0].periodos_cuota ? ` ${pagosDelMov[0].periodos_cuota.anio}` : ''}
                                    </span>
                                  )}
                                  {mov.monto_pendiente > 0 && (
                                    <span style={{ color: '#fac775', marginLeft: 8 }}>· {formatearMontoConSimbolo(mov.monto_pendiente)} con clasificación adicional</span>
                                  )}
                                </span>
                              ) : (
                                <strong>{mov.socios ? `${mov.socios.nombre} ${mov.socios.apellido} (${mov.socios.numero_socio})` : 'Socio'}</strong>
                              )}
                            </div>
                            {editable && (
                              <button className="btn btn-sm" style={{ color: '#f09595', borderColor: 'rgba(240,149,149,0.4)', fontSize: 11, flexShrink: 0 }}
                                onClick={() => handleDesconciliar(mov)}>
                                <i className="ti ti-arrow-back-up"></i> Desconciliar
                              </button>
                            )}
                          </div>
                          {tieneMultiples && (
                            <div style={{ display: 'flex', gap: 6, marginLeft: 24, flexWrap: 'wrap' }}>
                              {pagosDelMov.map(p => (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(201,168,76,0.15)', borderRadius: 6, padding: '4px 10px', fontSize: 11 }}>
                                  <span style={{ ...conceptoColor(p.concepto), display: 'inline-flex', padding: '1px 7px', borderRadius: 4, fontSize: 10, fontWeight: 500 }}>
                                    {p.concepto || 'Pago'}{p.periodos_cuota ? ` ${p.periodos_cuota.anio}` : ''}
                                  </span>
                                  <span style={{ color: '#5dcaa5', fontWeight: 500 }}>{formatearMontoConSimbolo(p.monto)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )
              })
            )}
          </div>

          {/* SECCIÓN CARGOS */}
          {movimientos.filter(m => m.tipo === 'cargo').length > 0 && (
            <div className="card" style={{ marginTop: '1rem' }}>
              <div className="card-header">
                <div className="card-title"><i className="ti ti-arrow-up-circle"></i> Egresos — vincular con cheques emitidos</div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                  {movimientos.filter(m => m.tipo === 'cargo' && m.estado === 'conciliado').length} / {movimientos.filter(m => m.tipo === 'cargo').length} vinculados
                </span>
              </div>
              {movimientos.filter(m => m.tipo === 'cargo').map(mov => {
                const chequeVinculado = chequesChequera.find(c => c.id === mov.chequera_detalle_id)
                const sugerido = chequesChequera.find(c =>
                  mov.n_documento && String(c.folio) === String(mov.n_documento)
                )
                const pagoCxPVinculado = pagoCxPDe(mov.id)
                const candidatosCxP = candidatosPagoCxP(mov)
                return (
                  <div key={mov.id} style={{ borderBottom: '0.5px solid rgba(201,168,76,0.08)', padding: '1rem 1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                            {mov.fecha.split('-').reverse().join('/')}
                          </span>
                          {mov.n_documento && (
                            <span style={{ fontFamily: 'monospace', fontSize: 11, background: 'rgba(201,168,76,0.1)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '1px 7px', color: 'var(--text-muted)' }}>
                              Doc N° {mov.n_documento}
                            </span>
                          )}
                          {mov.estado === 'conciliado'
                            ? <span className="badge badge-active"><i className="ti ti-check" style={{ fontSize: 10 }}></i> Vinculado</span>
                            : sugerido
                              ? <span className="badge badge-pending">Cheque detectado</span>
                              : <span className="badge badge-inactive">Sin vincular</span>
                          }
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{mov.descripcion}</div>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 'bold', color: '#f09595' }}>
                        {formatearMontoConSimbolo(Math.abs(mov.monto))}
                      </div>
                    </div>

                    {editable && mov.estado !== 'conciliado' && (
                      sugerido ? (
                        <div style={{ background: 'rgba(29,158,117,0.1)', border: '0.5px solid rgba(29,158,117,0.3)', borderRadius: 8, padding: '0.6rem 0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <i className="ti ti-book" style={{ fontSize: 20, color: '#5dcaa5' }}></i>
                            <div>
                              <div style={{ fontSize: 13, color: '#c8d0dc' }}>
                                Cheque N°{sugerido.folio} — {formatearMontoConSimbolo(sugerido.monto)}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
                                {sugerido.beneficiario || '—'} · {sugerido.concepto || '—'} · {sugerido.estado}
                              </div>
                            </div>
                          </div>
                          <button className="btn btn-sm" style={{ color: '#5dcaa5', borderColor: 'rgba(29,158,117,0.4)' }}
                            onClick={() => handleVincularCargo(mov.id, sugerido.id)}>
                            <i className="ti ti-link"></i> Vincular
                          </button>
                        </div>
                      ) : (
                        <div style={{ background: 'rgba(201,168,76,0.06)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <i className="ti ti-alert-circle" style={{ fontSize: 14 }}></i>
                            {candidatosCxP.length > 0
                              ? 'Sin cheque detectado — selecciona de Control chequera o de Cuentas por pagar'
                              : 'Sin cheque detectado — selecciona de Control chequera'}
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <select
                              value={vinculandoCargo[mov.id] || ''}
                              onChange={e => setVinculandoCargo(prev => ({ ...prev, [mov.id]: e.target.value }))}
                              style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }}
                            >
                              <option value="">Seleccionar documento a vincular…</option>
                              <optgroup label="Cheques emitidos">
                                {chequesChequera.filter(c => c.estado !== 'cobrado').map(c => (
                                  <option key={c.id} value={c.id}>
                                    N°{c.folio} — {formatearMontoConSimbolo(c.monto)} · {c.beneficiario || c.concepto || '—'}
                                  </option>
                                ))}
                              </optgroup>
                              {/* Pagos CxP que no salieron por cheque. Solo los de monto exacto:
                                  a diferencia del cheque, acá no hay folio que confirme el calce,
                                  así que el monto es la única evidencia dura. */}
                              {candidatosCxP.length > 0 && (
                                <optgroup label="Pagos de Cuentas por pagar">
                                  {candidatosCxP.map(p => (
                                    <option key={p.id} value={p.id}>
                                      {etiquetaPagoCxP(p)} · {p.medio_pago} · {p.fecha_pago.split('-').reverse().join('/')}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                            {/* El id elegido puede ser de chequera_detalle o de pagos_cuenta;
                                son UUID de tablas distintas, así que la búsqueda desambigua
                                sin tocar la ruta de cheques. */}
                            <button className="btn btn-sm btn-primary"
                              onClick={() => {
                                const val = vinculandoCargo[mov.id]
                                if (pagosCxP.some(p => p.id === val)) handleVincularPagoCxP(mov, val)
                                else handleVincularCargo(mov.id, val)
                              }}
                              disabled={!vinculandoCargo[mov.id]}>
                              <i className="ti ti-link"></i> Vincular
                            </button>
                          </div>
                        </div>
                      )
                    )}

                    {mov.estado === 'conciliado' && !chequeVinculado && pagoCxPVinculado && (
                      <div style={{ background: 'rgba(29,158,117,0.1)', border: '0.5px solid rgba(29,158,117,0.3)', borderRadius: 8, padding: '0.6rem 0.9rem', fontSize: 12, color: '#5dcaa5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <i className="ti ti-circle-check" style={{ fontSize: 16 }}></i>
                          Vinculado a {etiquetaPagoCxP(pagoCxPVinculado)}
                          <span style={{ color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
                            · {formatearMontoConSimbolo(pagoCxPVinculado.monto)} · {pagoCxPVinculado.medio_pago} · {pagoCxPVinculado.fecha_pago.split('-').reverse().join('/')}
                          </span>
                        </div>
                        {editable && (
                          <button className="btn btn-sm" style={{ color: '#f09595', borderColor: 'rgba(240,149,149,0.4)', fontSize: 11 }}
                            onClick={() => handleDesvincularPagoCxP(mov, pagoCxPVinculado)}>
                            <i className="ti ti-arrow-back-up"></i> Desvincular
                          </button>
                        )}
                      </div>
                    )}

                    {mov.estado === 'conciliado' && chequeVinculado && (
                      <div style={{ background: 'rgba(29,158,117,0.1)', border: '0.5px solid rgba(29,158,117,0.3)', borderRadius: 8, padding: '0.6rem 0.9rem', fontSize: 12, color: '#5dcaa5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <i className="ti ti-circle-check" style={{ fontSize: 16 }}></i>
                          Vinculado a Cheque N°{chequeVinculado.folio} — {formatearMontoConSimbolo(chequeVinculado.monto)}
                          {chequeVinculado.beneficiario && ` · ${chequeVinculado.beneficiario}`}
                        </div>
                        {editable && (
                          <button className="btn btn-sm" style={{ color: '#f09595', borderColor: 'rgba(240,149,149,0.4)', fontSize: 11 }}
                            onClick={() => handleDesvincularCargo(mov)}>
                            <i className="ti ti-arrow-back-up"></i> Desvincular
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
      {vista === 'sin_conciliar' && (() => {
        const basePagosSC = verExcluidos ? pagosNoAplica : pagosSinConciliar
        const pagosFiltradosSC = basePagosSC.filter(p => {
          if (filtroPagosSC !== 'todos' && p.forma_pago !== filtroPagosSC) return false
          if (periodoPagosSC !== 'todos' && p.periodo_id !== periodoPagosSC) return false
          return true
        })
        const sum = (arr) => arr.reduce((t, p) => t + (p.monto || 0), 0)
        const transferencias = pagosFiltradosSC.filter(p => p.forma_pago === 'transferencia')
        const chequesP = pagosFiltradosSC.filter(p => p.forma_pago === 'cheque')
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif' }}>Período:</span>
              <select value={periodoPagosSC} onChange={e => setPeriodoPagosSC(e.target.value)} style={{ fontSize: 13, width: 'auto' }}>
                <option value="todos">Todos los períodos</option>
                {periodos.map(p => <option key={p.id} value={p.id}>{p.anio} — {formatearMontoConSimbolo(p.monto)}</option>)}
              </select>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className={`btn btn-sm${verExcluidos ? '' : ' btn-primary'}`} onClick={() => setVerExcluidos(false)}>
                  <i className="ti ti-alert-circle"></i> Pendientes ({pagosSinConciliar.length})
                </button>
                <button className={`btn btn-sm${verExcluidos ? ' btn-primary' : ''}`} onClick={() => setVerExcluidos(true)}>
                  <i className="ti ti-circle-off"></i> Sin conciliación aplicable ({pagosNoAplica.length})
                </button>
              </div>
            </div>
            {verExcluidos && (
              <div style={{ padding: '0.7rem 0.9rem', borderRadius: 8, fontSize: 12, fontFamily: 'sans-serif', marginBottom: '1rem', background: 'rgba(55,138,221,0.1)', border: '0.5px solid rgba(55,138,221,0.3)', color: '#85b7eb' }}>
                <i className="ti ti-info-circle"></i> Pagos que nunca aparecerán en cartola: canjes, saldos de apertura, o depósitos cuya cartola el banco ya no entrega.
                Siguen sumando en los reportes financieros; solo salen de la conciliación. Si el banco entrega una cartola histórica, devuélvelos con <strong>Volver a pendiente</strong>.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: '1rem' }}>
              <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.85rem 1rem', borderLeft: '3px solid #fac775' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Pagos sin conciliar</div>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#fac775' }}>{pagosFiltradosSC.length}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 2 }}>Registrados manualmente</div>
              </div>
              <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.85rem 1rem', borderLeft: '3px solid #85b7eb' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Monto total</div>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#85b7eb' }}>{formatearMontoConSimbolo(sum(pagosFiltradosSC))}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 2 }}>Pendiente en cartola</div>
              </div>
              <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.85rem 1rem', borderLeft: '3px solid #5dcaa5' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Transferencias</div>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#5dcaa5' }}>{transferencias.length}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 2 }}>{formatearMontoConSimbolo(sum(transferencias))}</div>
              </div>
              <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.85rem 1rem', borderLeft: '3px solid var(--text-muted)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Cheques</div>
                <div style={{ fontSize: 20, fontWeight: 'bold' }}>{chequesP.length}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 2 }}>{formatearMontoConSimbolo(sum(chequesP))}</div>
              </div>
            </div>

            <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'sans-serif' }}>
              <i className="ti ti-info-circle" style={{ fontSize: 16, flexShrink: 0 }}></i>
              Estos son pagos registrados en el sistema (cuotas, incorporaciones) que aún no aparecen como movimientos en ninguna cartola bancaria cargada. Al cargar la cartola del período correspondiente, deberían conciliarse automáticamente.
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">
                  <i className={`ti ${verExcluidos ? 'ti-circle-off' : 'ti-alert-circle'}`}></i>{' '}
                  {verExcluidos ? 'Pagos sin conciliación aplicable' : 'Pagos registrados pendientes de aparecer en cartola'}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['todos','transferencia','cheque','efectivo'].map(f => (
                    <button key={f} className={`btn btn-sm${filtroPagosSC === f ? ' btn-primary' : ''}`} onClick={() => setFiltroPagosSC(f)}>
                      {f === 'todos' ? 'Todos' : f.charAt(0).toUpperCase() + f.slice(1) + 's'}
                    </button>
                  ))}
                </div>
              </div>
              {pagosFiltradosSC.length === 0 ? (
                <div className="empty-state"><i className="ti ti-circle-check" style={{ color: '#5dcaa5' }}></i>
                  {verExcluidos ? 'No hay pagos excluidos de la conciliación' : 'Todos los pagos registrados están conciliados con la cartola'}
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Socio</th><th>Fecha pago</th><th>Concepto</th><th>Período</th><th>Monto</th><th>Forma pago</th><th>Detalle</th>
                      {editable && esAdmin && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pagosFiltradosSC.map(p => {
                      const esIncorporacion = (p.concepto || '').toLowerCase().includes('incorpora')
                      const conceptoStyle = esIncorporacion
                        ? { background: 'rgba(239,159,39,0.15)', color: '#fac775', border: '0.5px solid rgba(239,159,39,0.3)' }
                        : { background: 'rgba(55,138,221,0.15)', color: '#85b7eb', border: '0.5px solid rgba(55,138,221,0.3)' }
                      return (
                        <tr key={p.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(55,138,221,0.2)', color: '#85b7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 'bold', flexShrink: 0 }}>
                                {p.socios ? `${p.socios.nombre?.[0] || ''}${p.socios.apellido?.[0] || ''}` : '??'}
                              </div>
                              <div>
                                <div style={{ fontWeight: 500 }}>{p.socios ? `${p.socios.nombre} ${p.socios.apellido}` : '—'}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>{p.socios?.numero_socio || ''}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ color: 'var(--text-muted)' }}>{p.fecha_pago ? p.fecha_pago.split('-').reverse().join('/') : '—'}</td>
                          <td><span className="badge" style={conceptoStyle}>{p.concepto || '—'}</span></td>
                          <td style={{ color: 'var(--text-muted)' }}>{p.periodos_cuota?.anio || '—'}</td>
                          <td style={{ color: '#5dcaa5', fontWeight: 'bold' }}>{formatearMontoConSimbolo(p.monto)}</td>
                          <td>
                            {p.forma_pago === 'transferencia' && <span className="badge" style={{ background: 'rgba(55,138,221,0.15)', color: '#85b7eb', border: '0.5px solid rgba(55,138,221,0.3)' }}>Transferencia</span>}
                            {p.forma_pago === 'cheque' && <span className="badge badge-inactive">Cheque</span>}
                            {p.forma_pago === 'efectivo' && <span className="badge" style={{ background: 'rgba(29,158,117,0.15)', color: '#5dcaa5', border: '0.5px solid rgba(29,158,117,0.3)' }}>Efectivo</span>}
                            {!['transferencia','cheque','efectivo'].includes(p.forma_pago) && <span className="badge badge-inactive">{p.forma_pago || '—'}</span>}
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', whiteSpace: 'pre-line' }}>
                            {p.cheques ? `Cheque N°${p.cheques.numero} · ${p.cheques.estado}` : (p.comentario || 'Registrado manualmente')}
                          </td>
                          {editable && esAdmin && (
                            <td>
                              {verExcluidos ? (
                                <button className="btn btn-sm" style={{ color: '#fac775', borderColor: 'rgba(239,159,39,0.4)' }}
                                  title="Devolver este pago a la conciliación" onClick={() => handleRevertirNoAplica(p)}>
                                  <i className="ti ti-arrow-back-up"></i> Volver a pendiente
                                </button>
                              ) : (
                                <button className="btn btn-sm" style={{ color: '#85b7eb', borderColor: 'rgba(55,138,221,0.4)' }}
                                  title="Este pago nunca aparecerá en cartola" onClick={() => abrirNoAplica(p)}>
                                  <i className="ti ti-circle-off"></i>
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )
      })()}
      {vista === 'movimientos' && selectedCartola && (
        <>
          {/* Banco y resumen */}
          <div style={{ display: 'flex', gap: 12, marginBottom: '1rem', alignItems: 'stretch' }}>
            {/* Banco */}
            <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <i className="ti ti-building-bank" style={{ fontSize: 28, color: 'var(--gold-dim)' }}></i>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--gold-light)' }}>{selectedCartola.banco || 'Santander'}</div>
                  {selectedCartola.tipo === 'ultimos_movimientos'
                    ? <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(55,138,221,0.15)', color: '#85b7eb', fontFamily: 'sans-serif', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <i className="ti ti-refresh" style={{ fontSize: 11 }}></i> Últimos movimientos
                      </span>
                    : <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(29,158,117,0.15)', color: '#5dcaa5', fontFamily: 'sans-serif' }}>Cartola mensual</span>
                  }
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>{formatearPeriodoCartola(selectedCartola)}</div>
              </div>
            </div>

            {/* Resumen */}
            <div style={{ flex: 1, background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem 1.5rem' }}>
              {selectedCartola.tipo === 'ultimos_movimientos' ? (
                <>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Resumen del período</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                    {[
                      { label: 'Total abonos', value: movimientos.filter(m => m.tipo === 'abono').reduce((t,m) => t + m.monto, 0), color: '#5dcaa5' },
                      { label: 'Total cargos', value: Math.abs(movimientos.filter(m => m.tipo === 'cargo').reduce((t,m) => t + m.monto, 0)), color: '#f09595' },
                      { label: 'Saldo actual', value: movimientos[0]?.saldo, color: 'var(--gold-light)' },
                      { label: 'Sin conciliar', value: null, color: '#fac775', text: `${movimientos.filter(m => m.tipo === 'abono' && m.estado !== 'conciliado').length} abonos` },
                    ].map(s => (
                      <div key={s.label}>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontSize: 15, fontWeight: 'bold', color: s.color }}>
                          {s.text || (s.value ? formatearMontoConSimbolo(s.value) : '—')}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <i className="ti ti-info-circle" style={{ fontSize: 13 }}></i>
                    Al cargar la cartola mensual oficial, el sistema verificará duplicados automáticamente
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Resumen cuenta corriente</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                    {[
                      { label: 'Saldo inicial', value: resumen?.saldoInicial, color: 'var(--text-muted)' },
                      { label: 'Otros abonos', value: resumen?.otrosAbonos, color: '#5dcaa5' },
                      { label: 'Otros cargos', value: resumen?.otrosCargos, color: '#f09595' },
                      { label: 'Saldo final', value: resumen?.saldoFinal, color: 'var(--gold-light)' },
                    ].map(s => (
                      <div key={s.label}>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontSize: 15, fontWeight: 'bold', color: s.value ? s.color : 'var(--text-dim)' }}>
                          {s.value ? formatearMontoConSimbolo(s.value) : '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title"><i className="ti ti-list"></i> Movimientos — {formatearPeriodoCartola(selectedCartola)}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['todos','abonos','pendientes','conciliados','sin_calce','ignorados'].map(f => (
                  <button key={f} className={`btn btn-sm${filtro === f ? ' btn-primary' : ''}`} onClick={() => setFiltro(f)}>
                    {f === 'todos' ? 'Todos' : f === 'abonos' ? 'Abonos' : f === 'pendientes' ? 'Pendientes' : f === 'conciliados' ? 'Conciliados' : f === 'sin_calce' ? 'Sin calce' : 'Ignorados'}
                  </button>
                ))}
              </div>
            </div>
            {filtrados.length === 0 ? (
              <div className="empty-state"><i className="ti ti-list-off"></i>Sin movimientos con ese filtro</div>
            ) : (
              <table>
                <thead><tr><th>Fecha</th><th>Descripción</th><th>RUT detectado</th><th>Monto</th><th>Estado</th></tr></thead>
                <tbody>
                  {filtrados.map(m => (
                    <tr key={m.id} style={{ borderLeft: `2px solid ${m.tipo === 'abono' ? 'var(--success)' : 'var(--danger)'}` }}>
                      <td style={{ color: 'var(--text-muted)' }}>{m.fecha.split('-').reverse().join('/')}</td>
                      <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.descripcion}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{m.rut_detectado || '—'}</td>
                      <td className={m.tipo === 'abono' ? 'amount-pos' : 'amount-neg'}>
                        {m.tipo === 'abono' ? '+' : ''}{formatearMontoConSimbolo(Math.abs(m.monto))}
                      </td>
                      <td>
                        {m.estado === 'conciliado' && <span className="badge badge-active">Conciliado</span>}
                        {m.estado === 'pendiente' && <span className="badge badge-pending">Pendiente</span>}
                        {m.estado === 'gasto' && <span className="badge badge-inactive">Gasto</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Modal: marcar un pago como "conciliación no aplica" */}
      {marcarNoAplica && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setMarcarNoAplica(null)}>
          <div className="modal" style={{ width: 520 }}>
            <div className="modal-header">
              <div className="modal-title">Conciliación no aplica</div>
              <button className="btn btn-sm" onClick={() => setMarcarNoAplica(null)}><i className="ti ti-x"></i></button>
            </div>
            <div style={{ padding: '0.5rem 1.25rem 0.75rem', fontSize: 13, color: '#c8d0dc', fontFamily: 'sans-serif' }}>
              <strong>{marcarNoAplica.socios ? `${marcarNoAplica.socios.nombre} ${marcarNoAplica.socios.apellido}` : 'Socio'}</strong>{' '}
              · {formatearMontoConSimbolo(marcarNoAplica.monto)} · {marcarNoAplica.fecha_pago?.split('-').reverse().join('/')}
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                El pago sale del panel de pendientes y deja de ofrecerse como candidato de calce.
                Sigue sumando igual en los reportes financieros. Es reversible desde "Sin conciliación aplicable".
              </div>
            </div>
            <div className="form-grid">
              <div className="form-group full"><label>Motivo *</label>
                <input value={motivoNoAplica} onChange={e => setMotivoNoAplica(e.target.value)}
                  placeholder="Ej: canje por servicios · saldo de apertura · el banco ya no entrega esta cartola" />
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 4 }}>
                  Se agrega al comentario del pago junto a tu nombre y la fecha.
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setMarcarNoAplica(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleMarcarNoAplica} disabled={guardandoNoAplica || !motivoNoAplica.trim()}>
                {guardandoNoAplica ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-circle-off"></i> Excluir de la conciliación</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectorCheque && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setSelectorCheque(null)}>
          <div className="modal" style={{ width: 560 }}>
            <div className="modal-header">
              <div className="modal-title"><i className="ti ti-writing"></i> ¿Qué cheque amarrar?</div>
              <button className="btn btn-sm" onClick={() => setSelectorCheque(null)}><i className="ti ti-x"></i></button>
            </div>
            <div style={{ padding: '0 1.25rem 0.5rem', fontSize: 13, color: 'var(--text-muted)' }}>
              {selectorCheque.mov.socios ? `${selectorCheque.mov.socios.nombre} ${selectorCheque.mov.socios.apellido}` : 'El socio'} tiene varios cheques depositados de {formatearMontoConSimbolo(Math.abs(selectorCheque.mov.monto))} sin amarrar. {selectorCheque.preseleccion ? 'Se preseleccionó el de fecha más cercana al depósito' : 'Hay empate de fechas — elige cuál corresponde'} ({selectorCheque.mov.fecha?.split('-').reverse().join('/')}):
            </div>
            <div style={{ padding: '0.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {selectorCheque.candidatos.map((ch, i) => {
                const esPre = ch.id === selectorCheque.preseleccion
                return (
                  <button key={ch.id} className={`btn${esPre ? ' btn-primary' : ''}`} style={{ justifyContent: 'space-between', textAlign: 'left' }}
                    onClick={() => amarrarChequeAMovimiento(selectorCheque.mov, ch)}>
                    <span>
                      <i className="ti ti-writing" style={{ marginRight: 6 }}></i>
                      Cheque N°{ch.numero}
                      {esPre && <span className="badge badge-active" style={{ marginLeft: 8 }}>Más cercano</span>}
                    </span>
                    <span style={{ color: esPre ? 'inherit' : 'var(--text-muted)', fontSize: 12 }}>
                      dep. {ch.fecha_deposito ? ch.fecha_deposito.split('-').reverse().join('/') : '—'} · {formatearMontoConSimbolo(ch.monto)}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setSelectorCheque(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
