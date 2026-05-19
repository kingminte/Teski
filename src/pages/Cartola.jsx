import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import { formatearMontoConSimbolo, parsearMonto, formatearMonto } from '../lib/montos'
import * as XLSX from 'xlsx'
import { parsearCartolaSantander, extraerCabeceraCartola, extraerResumenCartola, parsearUltimosMovimientos, extraerCabeceraUltimosMovimientos, detectarTipoArchivo, extraerMesAnioDeNombre } from '../lib/parsearCartola'

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
  const { puedeEditar } = useAuth()
  const editable = puedeEditar('cartola')
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
  const [vinculandoCargo, setVinculandoCargo] = useState({}) // { movId: chequeId }

  const normRut = (r) => r ? r.replace(/\s/g,'').replace(/\./g,'').toLowerCase() : ''
  const [selectedCartola, setSelectedCartola] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [filtro, setFiltro] = useState('todos')
  const [vista, setVista] = useState('movimientos')
  const [resumen, setResumen] = useState(null)
  const [conciliando, setConciliando] = useState({})
  const [pagosSinConciliar, setPagosSinConciliar] = useState([])
  const [filtroPagosSC, setFiltroPagosSC] = useState('todos')
  const [periodoPagosSC, setPeriodoPagosSC] = useState('todos')
  const [otrosIngresosForm, setOtrosIngresosForm] = useState({})

  const loadPagosSinConciliar = async () => {
    const { data } = await supabase
      .from('pagos_cuota')
      .select('*, socios(nombre,apellido,numero_socio), periodos_cuota(anio), cheques(numero,estado)')
      .is('movimiento_id', null)
      .order('fecha_pago', { ascending: false })
    setPagosSinConciliar(data || [])
  }

  useEffect(() => {
    loadCartolas()
    loadPagosSinConciliar()
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
    console.log('=== handleFile INICIO ===', { nombre: file.name, tamaño: file.size })
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['xls','xlsx','csv'].includes(ext)) { showToast('Formato no soportado', 'error'); return }
    setUploading(true)
    try {
      // 1. Verificar duplicado por nombre
      const { data: existente } = await supabase.from('cartolas').select('id').eq('nombre_archivo', file.name).maybeSingle()
      if (existente) {
        console.log('BLOQUEADO: cartola ya existe con ese nombre', existente)
        showToast(`La cartola "${file.name}" ya fue cargada anteriormente`, 'error')
        setUploading(false)
        return
      }

      console.log('Leyendo archivo Excel…')
      const rows = await parseFile(file)
      console.log('Filas leídas:', rows.length)
      console.log('Fila 0:', rows[0])
      console.log('Fila 20:', rows[20])
      console.log('Fila 21:', rows[21])

      // 2. Detectar tipo de archivo
      const tipoArchivo = detectarTipoArchivo(file.name, rows)
      const esUltimosMovimientos = tipoArchivo === 'ultimos_movimientos'
      console.log('Tipo archivo detectado:', tipoArchivo)

      // 3. Parsear según tipo
      let movs, cabecera, resumenData
      if (esUltimosMovimientos) {
        movs = parsearUltimosMovimientos(rows)
        cabecera = extraerCabeceraUltimosMovimientos(rows)
        resumenData = null // No tiene resumen de cuenta corriente
      } else {
        console.log('Llamando a parsearCartolaSantander…')
        movs = parsearCartolaSantander(rows)
        cabecera = extraerCabeceraCartola(rows)
        resumenData = extraerResumenCartola(rows)
      }
      console.log('Movimientos parseados:', movs.length, 'cabecera:', cabecera)

      if (movs.length === 0) { showToast('No se encontraron movimientos. Verifica el formato.', 'error'); setUploading(false); return }

      // 4. Verificar N° de documento duplicado (solo para cartola mensual con n_doc real)
      if (!esUltimosMovimientos) {
        const nDocs = movs.filter(m => m.n_documento).map(m => m.n_documento)
        console.log('Verificando N° doc duplicados, total:', nDocs.length, nDocs)
        if (nDocs.length > 0) {
          const { data: docsDuplicados } = await supabase.from('movimientos').select('n_documento').in('n_documento', nDocs)
          console.log('N° doc duplicados encontrados:', docsDuplicados)
          if (docsDuplicados?.length > 0) {
            const dupes = docsDuplicados.map(d => d.n_documento).join(', ')
            console.log('BLOQUEADO: N° doc ya existen en BD')
            showToast(`Movimientos duplicados detectados (N° doc: ${dupes}). Esta cartola ya fue registrada.`, 'error')
            setUploading(false)
            return
          }
        }
      }

      // 5. Cruzar con socios por RUT (directo o vía alias aprendido)
      const movsConCalce = movs.map(m => {
        if (!m.rut_detectado) return m
        const rutMov = normRut(m.rut_detectado)
        const socio = socios.find(s => normRut(s.rut) === rutMov)
        if (socio) return { ...m, socio_id: socio.id, estado: 'pendiente' }
        const alias = rutAlias.find(a => normRut(a.rut) === rutMov)
        if (alias) return { ...m, socio_id: alias.socio_id, estado: 'pendiente' }
        return m
      })

      // 6. Calcular resumen financiero
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

      // 7. Crear cartola
      let mes = cabecera.mes
      let anio = cabecera.anio
      if (!mes || !anio) {
        const deNombre = extraerMesAnioDeNombre(file.name)
        mes = mes || deNombre.mes
        anio = anio || deNombre.anio
      }
      const periodo = (mes && anio) ? `${anio}-${String(mes).padStart(2,'0')}` : new Date().toISOString().slice(0, 7)
      console.log('Insertando cartola en BD…', { nombre_archivo: file.name, periodo, mes, anio, total: movsConCalce.length, tipo: tipoArchivo, ...resumenCartola })
      const { data: cartola, error } = await supabase.from('cartolas')
        .insert({
          nombre_archivo: file.name,
          periodo,
          mes: mes || null,
          anio: anio || null,
          total_movimientos: movsConCalce.length,
          banco: cabecera.banco || 'Santander',
          tipo: tipoArchivo,
          ...resumenCartola,
        })
        .select().single()
      if (error) { console.error('Error creando cartola:', error); throw new Error('Error creando cartola: ' + error.message) }
      console.log('Cartola insertada:', cartola)

      // 8. Insertar movimientos
      const toInsert = movsConCalce.map(m => ({ ...m, cartola_id: cartola.id }))
      console.log('Insertando', toInsert.length, 'movimientos. Primero:', toInsert[0])
      const { error: mErr } = await supabase.from('movimientos').insert(toInsert)
      if (mErr) { console.error('Error guardando movimientos:', mErr); throw new Error('Error guardando movimientos: ' + mErr.message) }
      console.log('Movimientos insertados OK')

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

  const handleConfirmarCalce = async (mov) => {
    const c = conciliando[mov.id]
    if (!c?.lineas?.length) return

    const montoTotal = Math.abs(mov.monto)
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
      if (e1) { console.error('Error vinculando movimiento:', e1); showToast('Error al vincular movimiento: ' + e1.message, 'error'); return }

      const { error: e2 } = await supabase.from('chequera_detalle').update({ estado: 'cobrado' }).eq('id', chequeId)
      if (e2) { console.error('Error actualizando cheque:', e2); showToast('Error al actualizar cheque: ' + e2.message, 'error'); return }

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
    if (!confirm('¿Desconciliar este movimiento? Se eliminarán los pagos de cuota y otros ingresos asociados, y el movimiento volverá a estado pendiente.')) return
    try {
      const { error: ePago } = await supabase.from('pagos_cuota').delete().eq('movimiento_id', mov.id)
      if (ePago) throw new Error(ePago.message)

      const { error: eOtros } = await supabase.from('otros_ingresos').delete().eq('movimiento_id', mov.id)
      if (eOtros) throw new Error(eOtros.message)

      const { error: eMov } = await supabase.from('movimientos').update({
        estado: 'pendiente',
        monto_conciliado: 0,
        monto_pendiente: 0,
      }).eq('id', mov.id)
      if (eMov) throw new Error(eMov.message)

      setConciliando(prev => { const n = { ...prev }; delete n[mov.id]; return n })
      showToast('Movimiento desconciliado correctamente')
      loadMovimientos(selectedCartola.id)
    } catch (e) {
      showToast('Error al desconciliar: ' + e.message, 'error')
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

  const abonos = movimientos.filter(m => m.tipo === 'abono')
  const conCalce = abonos.filter(m => m.socio_id)
  const confirmados = abonos.filter(m => m.estado === 'conciliado')
  const pendientes = conCalce.filter(m => m.estado !== 'conciliado')
  const sinCalce = abonos.filter(m => !m.socio_id && m.estado !== 'conciliado')

  const filtrados = movimientos.filter(m => {
    if (filtro === 'abonos') return m.tipo === 'abono'
    if (filtro === 'pendientes') return m.tipo === 'abono' && m.estado !== 'conciliado'
    if (filtro === 'conciliados') return m.estado === 'conciliado'
    if (filtro === 'sin_calce') return m.tipo === 'abono' && !m.socio_id && m.estado !== 'conciliado'
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
                    {mov.estado !== 'conciliado' && (() => {
                      const esAlias = socioCalce && mov.rut_detectado && normRut(socioCalce.rut) !== normRut(mov.rut_detectado)
                      const mostrarSelect = !socioCalce || cambiandoAlias[mov.id]
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
                            Sin cheque detectado — selecciona de Control chequera
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <select
                              value={vinculandoCargo[mov.id] || ''}
                              onChange={e => setVinculandoCargo(prev => ({ ...prev, [mov.id]: e.target.value }))}
                              style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }}
                            >
                              <option value="">Seleccionar cheque emitido…</option>
                              {chequesChequera.filter(c => c.estado !== 'cobrado').map(c => (
                                <option key={c.id} value={c.id}>
                                  N°{c.numero} — {formatearMontoConSimbolo(c.monto)} · {c.beneficiario || c.concepto || '—'}
                                </option>
                              ))}
                            </select>
                            <button className="btn btn-sm btn-primary"
                              onClick={() => handleVincularCargo(mov.id, vinculandoCargo[mov.id])}
                              disabled={!vinculandoCargo[mov.id]}>
                              <i className="ti ti-link"></i> Vincular
                            </button>
                          </div>
                        </div>
                      )
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
        const pagosFiltradosSC = pagosSinConciliar.filter(p => {
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
            </div>
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
                <div className="card-title"><i className="ti ti-alert-circle"></i> Pagos registrados pendientes de aparecer en cartola</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['todos','transferencia','cheque','efectivo'].map(f => (
                    <button key={f} className={`btn btn-sm${filtroPagosSC === f ? ' btn-primary' : ''}`} onClick={() => setFiltroPagosSC(f)}>
                      {f === 'todos' ? 'Todos' : f.charAt(0).toUpperCase() + f.slice(1) + 's'}
                    </button>
                  ))}
                </div>
              </div>
              {pagosFiltradosSC.length === 0 ? (
                <div className="empty-state"><i className="ti ti-circle-check" style={{ color: '#5dcaa5' }}></i>Todos los pagos registrados están conciliados con la cartola</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Socio</th><th>Fecha pago</th><th>Concepto</th><th>Período</th><th>Monto</th><th>Forma pago</th><th>Detalle</th>
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
                          <td style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
                            {p.cheques ? `Cheque N°${p.cheques.numero} · ${p.cheques.estado}` : (p.comentario || 'Registrado manualmente')}
                          </td>
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
                {['todos','abonos','pendientes','conciliados','sin_calce'].map(f => (
                  <button key={f} className={`btn btn-sm${filtro === f ? ' btn-primary' : ''}`} onClick={() => setFiltro(f)}>
                    {f === 'todos' ? 'Todos' : f === 'abonos' ? 'Abonos' : f === 'pendientes' ? 'Pendientes' : f === 'conciliados' ? 'Conciliados' : 'Sin calce'}
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
    </div>
  )
}
