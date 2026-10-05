import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import { formatearMontoConSimbolo, parsearMonto, formatearMonto } from '../lib/montos'
import { leerEstadoCuenta, recalcularCuenta, obtenerChequeraYFolio } from '../lib/cuentasPorPagar'

const MEDIOS_PAGO = [
  { value: 'cheque', label: 'Cheque' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'canje', label: 'Canje / Compensación' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'otro', label: 'Otro' },
]

// Lado gasto de un canje: la cuota de un socio se salda con servicios, así que
// no hay flujo bancario y el comentario es el único respaldo. Espejo del
// placeholder del formulario de pago de cuotas.
const PLACEHOLDER_CANJE = 'Describe la compensación: qué cuota/pago de socio salda este gasto y quién lo autorizó'

const CATEGORIA_DEFAULT = 'Otros gastos'

const EMPTY_CUENTA = {
  proveedor_id: '', concepto: '', categoria: CATEGORIA_DEFAULT, descripcion: '',
  monto_total: '', fecha_emision: new Date().toISOString().slice(0, 10),
  fecha_vencimiento: '', comentario: '',
}

const EMPTY_PAGO = {
  monto: '', fecha_pago: new Date().toISOString().slice(0, 10),
  medio_pago: 'transferencia', chequera_detalle_id: '', comentario: '',
}

const sumarMeses = (fechaStr, n) => {
  const d = new Date(fechaStr + 'T00:00:00')
  d.setMonth(d.getMonth() + n)
  return d.toISOString().slice(0, 10)
}

const formatearFecha = (f) => f ? f.split('-').reverse().join('/') : '—'
// dd/mm, para el concepto del cheque combinado (que se lee truncado en tabla)
const formatearFechaCorta = (f) => f ? f.split('-').reverse().slice(0, 2).join('/') : ''

const estadoBadge = (estado) => {
  if (estado === 'pagada') return <span className="badge badge-active">Pagada</span>
  if (estado === 'parcial') return <span className="badge badge-pending">Parcial</span>
  if (estado === 'anulada') return <span className="badge badge-inactive">Anulada</span>
  return <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500, background: 'rgba(240,149,149,0.15)', color: '#f09595' }}>Pendiente</span>
}

const hoyStr = () => new Date().toISOString().slice(0, 10)
const mesActual = () => new Date().toISOString().slice(0, 7)

export default function CuentasPorPagar() {
  const { showToast, ToastComponent } = useToast()
  const { puedeEditar } = useAuth()
  const editable = puedeEditar('cuentas_por_pagar')
  const fileRef = useRef()

  const [cuentas, setCuentas] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [planCuentasGasto, setPlanCuentasGasto] = useState([])
  const [chequesEmitidos, setChequesEmitidos] = useState([])
  const [pagosTodos, setPagosTodos] = useState([])
  const [respaldosTodos, setRespaldosTodos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [busqueda, setBusqueda] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [uploadingFor, setUploadingFor] = useState(null)
  const [exportando, setExportando] = useState(false)

  // Modal Nueva cuenta
  const [showNueva, setShowNueva] = useState(false)
  const [formNueva, setFormNueva] = useState(EMPTY_CUENTA)
  const [editCuentaId, setEditCuentaId] = useState(null)
  const [montoNueva, setMontoNueva] = useState('')
  const [enCuotas, setEnCuotas] = useState(false)
  const [nCuotas, setNCuotas] = useState(2)
  const [cuotasProgramadas, setCuotasProgramadas] = useState([])
  const [savingNueva, setSavingNueva] = useState(false)

  // Modal Registrar pago
  const [pagoCuentaId, setPagoCuentaId] = useState(null)
  const [formPago, setFormPago] = useState(EMPTY_PAGO)
  const [montoPago, setMontoPago] = useState('')
  const [savingPago, setSavingPago] = useState(false)

  // Modal Generar cheque
  const [chequeCuentaId, setChequeCuentaId] = useState(null)
  const [formCheque, setFormCheque] = useState({ monto: '', concepto: '', fecha: hoyStr() })
  const [montoCheque, setMontoCheque] = useState('')
  const [savingCheque, setSavingCheque] = useState(false)

  // Cheque por varias cuotas programadas
  const [cuotasSel, setCuotasSel] = useState({})           // { [pago_id]: true }
  const [chequeCuotasCuentaId, setChequeCuotasCuentaId] = useState(null)
  const [formChequeCuotas, setFormChequeCuotas] = useState({ concepto: '', fecha: hoyStr() })
  const [savingChequeCuotas, setSavingChequeCuotas] = useState(false)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    const [cuentasRes, proveedoresRes, planRes, chequeraRes, pagosRes, respaldosRes] = await Promise.all([
      supabase.from('cuentas_por_pagar').select('*, proveedores(id,nombre,rut,giro,email,telefono)').order('fecha_emision', { ascending: false }),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
      supabase.from('plan_cuentas').select('id,nombre').eq('tipo', 'gasto').eq('activo', true).order('nombre'),
      supabase.from('chequera_detalle').select('id,folio,monto,beneficiario,concepto,estado,chequera_id').order('folio'),
      supabase.from('pagos_cuenta').select('*, chequera_detalle(folio,beneficiario)').order('fecha_pago'),
      supabase.from('respaldos_cuenta').select('*').order('created_at', { ascending: false }),
    ])
    setCuentas(cuentasRes.data || [])
    setProveedores(proveedoresRes.data || [])
    setPlanCuentasGasto(planRes.data || [])
    setChequesEmitidos(chequeraRes.data || [])
    setPagosTodos(pagosRes.data || [])
    setRespaldosTodos(respaldosRes.data || [])
    setLoading(false)
  }

  const pagosDe = (cuentaId) => pagosTodos.filter(p => p.cuenta_id === cuentaId)
  const respaldosDe = (cuentaId) => respaldosTodos.filter(r => r.cuenta_id === cuentaId)

  // ── Cuotas programadas (modal nueva cuenta) ─────────────
  const regenerarCuotas = (montoTotal, n, fechaBase) => {
    if (!montoTotal || n < 1) { setCuotasProgramadas([]); return }
    const base = Math.floor(montoTotal / n)
    const ajuste = montoTotal - base * n
    const rows = []
    for (let i = 0; i < n; i++) {
      rows.push({
        id: i,
        fecha: sumarMeses(fechaBase, i + 1),
        monto: formatearMonto(i === n - 1 ? base + ajuste : base),
      })
    }
    setCuotasProgramadas(rows)
  }

  const onChangeMontoNueva = (val) => {
    setMontoNueva(val)
    const n = parsearMonto(val)
    if (enCuotas && n > 0) regenerarCuotas(n, nCuotas, formNueva.fecha_emision)
  }

  const onChangeNCuotas = (val) => {
    const n = Math.max(1, parseInt(val) || 1)
    setNCuotas(n)
    const total = parsearMonto(montoNueva)
    if (enCuotas && total > 0) regenerarCuotas(total, n, formNueva.fecha_emision)
  }

  const onToggleCuotas = (val) => {
    setEnCuotas(val)
    const total = parsearMonto(montoNueva)
    if (val && total > 0) regenerarCuotas(total, nCuotas, formNueva.fecha_emision)
    else setCuotasProgramadas([])
  }

  const actualizarCuota = (idx, campo, valor) => {
    setCuotasProgramadas(prev => prev.map((c, i) => i === idx ? { ...c, [campo]: valor } : c))
  }

  const abrirNueva = () => {
    setFormNueva(EMPTY_CUENTA)
    setMontoNueva('')
    setEnCuotas(false)
    setNCuotas(2)
    setCuotasProgramadas([])
    setEditCuentaId(null)
    setShowNueva(true)
  }

  const abrirEditarCuenta = (cuenta) => {
    setFormNueva({
      proveedor_id: cuenta.proveedor_id || '',
      concepto: cuenta.concepto || '',
      descripcion: cuenta.descripcion || '',
      categoria: cuenta.categoria || CATEGORIA_DEFAULT,
      monto_total: cuenta.monto_total || 0,
      fecha_emision: cuenta.fecha_emision || hoyStr(),
      fecha_vencimiento: cuenta.fecha_vencimiento || '',
      comentario: cuenta.comentario || '',
    })
    setMontoNueva(formatearMonto(cuenta.monto_total || 0))
    setEnCuotas(false)
    setCuotasProgramadas([])
    setEditCuentaId(cuenta.id)
    setShowNueva(true)
  }

  const handleEliminarCuenta = async (cuenta) => {
    if ((cuenta.monto_pagado || 0) > 0) {
      showToast('No se puede eliminar una cuenta con pagos registrados. Anúlala en su lugar.', 'error')
      return
    }
    if (!confirm(`¿Eliminar la cuenta N°${cuenta.numero} — ${cuenta.concepto}? Esta acción no se puede deshacer.`)) return
    await supabase.from('respaldos_cuenta').delete().eq('cuenta_id', cuenta.id)
    const { error } = await supabase.from('cuentas_por_pagar').delete().eq('id', cuenta.id)
    if (error) { showToast('Error al eliminar: ' + error.message, 'error'); return }
    showToast('Cuenta eliminada')
    loadAll()
  }

  const handleGuardarCuenta = async () => {
    if (!formNueva.proveedor_id) { showToast('Selecciona un proveedor', 'error'); return }
    if (!formNueva.concepto.trim()) { showToast('El concepto es obligatorio', 'error'); return }
    if (!formNueva.categoria) { showToast('La categoría es obligatoria', 'error'); return }
    const total = parsearMonto(montoNueva)
    if (total <= 0) { showToast('El monto debe ser mayor a 0', 'error'); return }

    setSavingNueva(true)

    if (editCuentaId) {
      const cuentaActual = cuentas.find(c => c.id === editCuentaId)
      const tienePagos = (cuentaActual?.monto_pagado || 0) > 0
      const payload = {
        proveedor_id: formNueva.proveedor_id,
        concepto: formNueva.concepto.trim(),
        categoria: formNueva.categoria || null,
        descripcion: formNueva.descripcion || null,
        fecha_emision: formNueva.fecha_emision,
        fecha_vencimiento: formNueva.fecha_vencimiento || null,
        comentario: formNueva.comentario || null,
      }
      if (!tienePagos) payload.monto_total = total
      const { error: eUpd } = await supabase.from('cuentas_por_pagar').update(payload).eq('id', editCuentaId)
      setSavingNueva(false)
      if (eUpd) { showToast('Error al actualizar: ' + eUpd.message, 'error'); return }
      setShowNueva(false)
      setEditCuentaId(null)
      showToast('Cuenta actualizada')
      loadAll()
      return
    }

    const { data: cuenta, error } = await supabase.from('cuentas_por_pagar').insert({
      proveedor_id: formNueva.proveedor_id,
      concepto: formNueva.concepto.trim(),
      categoria: formNueva.categoria || null,
      descripcion: formNueva.descripcion || null,
      monto_total: total,
      monto_pagado: 0,
      fecha_emision: formNueva.fecha_emision,
      fecha_vencimiento: formNueva.fecha_vencimiento || null,
      estado: 'pendiente',
      comentario: formNueva.comentario || null,
    }).select().single()

    if (error) { setSavingNueva(false); showToast('Error al crear cuenta: ' + error.message, 'error'); return }

    if (enCuotas && cuotasProgramadas.length > 0) {
      const programados = cuotasProgramadas.map(c => ({
        cuenta_id: cuenta.id,
        monto: parsearMonto(c.monto),
        fecha_pago: c.fecha,
        medio_pago: 'cheque',
        estado: 'programado',
      })).filter(c => c.monto > 0)
      if (programados.length > 0) {
        const { error: ePagos } = await supabase.from('pagos_cuenta').insert(programados)
        if (ePagos) { showToast('Cuenta creada pero error en cuotas: ' + ePagos.message, 'error') }
      }
    }

    setSavingNueva(false)
    setShowNueva(false)
    showToast('Cuenta creada correctamente')
    loadAll()
  }

  // ── Registrar pago ─────────────────────────────────────
  const abrirPago = (cuenta) => {
    const saldo = cuenta.monto_total - (cuenta.monto_pagado || 0)
    setFormPago({ ...EMPTY_PAGO, monto: '' })
    setMontoPago(formatearMonto(saldo))
    setPagoCuentaId(cuenta.id)
  }

  const handleRegistrarPago = async () => {
    const cuenta = cuentas.find(c => c.id === pagoCuentaId)
    if (!cuenta) return
    const monto = parsearMonto(montoPago)
    if (monto <= 0) { showToast('Monto inválido', 'error'); return }
    if (formPago.medio_pago === 'canje' && !formPago.comentario.trim()) {
      showToast('Un canje necesita comentario: describe qué cuota de socio salda este gasto y quién lo autorizó', 'error'); return
    }

    setSavingPago(true)

    // Guard de saldo: se relee desde la base, el saldo en memoria puede estar viejo
    const est = await leerEstadoCuenta(cuenta.id)
    if (est.error) { setSavingPago(false); showToast('Error al leer la cuenta: ' + est.error.message, 'error'); return }
    if (monto > est.saldo) {
      setSavingPago(false)
      showToast(`El monto (${formatearMontoConSimbolo(monto)}) excede el saldo de la cuenta (${formatearMontoConSimbolo(est.saldo)})`, 'error')
      return
    }

    const { error: ePago } = await supabase.from('pagos_cuenta').insert({
      cuenta_id: cuenta.id,
      monto,
      fecha_pago: formPago.fecha_pago,
      medio_pago: formPago.medio_pago,
      chequera_detalle_id: formPago.medio_pago === 'cheque' && formPago.chequera_detalle_id ? formPago.chequera_detalle_id : null,
      comentario: formPago.comentario || null,
      estado: 'pagado',
    })
    if (ePago) { setSavingPago(false); showToast('Error al registrar pago: ' + ePago.message, 'error'); return }

    // El cheque queda 'emitido': usarlo para pagar una cuenta no significa que el
    // banco lo pagó. Pasa a 'cobrado' al calzarlo con la cartola o a mano.
    const rec = await recalcularCuenta(cuenta.id)
    if (rec.error) { setSavingPago(false); showToast('Pago registrado pero error actualizando cuenta: ' + rec.error.message, 'error'); loadAll(); return }

    setSavingPago(false)
    setPagoCuentaId(null)
    showToast('Pago registrado correctamente')
    loadAll()
  }

  // ── Generar cheque ─────────────────────────────────────
  const abrirGenerarCheque = (cuenta) => {
    const saldo = cuenta.monto_total - (cuenta.monto_pagado || 0)
    setFormCheque({ monto: '', concepto: cuenta.concepto || '', fecha: hoyStr() })
    setMontoCheque(formatearMonto(saldo))
    setChequeCuentaId(cuenta.id)
  }

  const handleGenerarCheque = async () => {
    const cuenta = cuentas.find(c => c.id === chequeCuentaId)
    if (!cuenta) return
    const monto = parsearMonto(montoCheque)
    if (monto <= 0) { showToast('Monto inválido', 'error'); return }

    setSavingCheque(true)

    // Guard de saldo antes de quemar un folio
    const est = await leerEstadoCuenta(cuenta.id)
    if (est.error) { setSavingCheque(false); showToast('Error al leer la cuenta: ' + est.error.message, 'error'); return }
    if (monto > est.saldo) {
      setSavingCheque(false)
      showToast(`El monto (${formatearMontoConSimbolo(monto)}) excede el saldo de la cuenta (${formatearMontoConSimbolo(est.saldo)})`, 'error')
      return
    }

    const cheq = await obtenerChequeraYFolio()
    if (cheq.error) { setSavingCheque(false); showToast(cheq.error.message, 'error'); return }
    const { chequera, folio } = cheq

    const { data: detalle, error: eDet } = await supabase.from('chequera_detalle').insert({
      chequera_id: chequera.id,
      folio,
      fecha: formCheque.fecha,
      beneficiario: cuenta.proveedores?.nombre || '',
      concepto: formCheque.concepto || cuenta.concepto,
      categoria: cuenta.categoria || CATEGORIA_DEFAULT,
      monto,
      estado: 'emitido',
    }).select().single()

    if (eDet) { setSavingCheque(false); showToast('Error generando cheque: ' + eDet.message, 'error'); return }

    // Desde acá el cheque ya existe: si algo falla se compensa borrándolo, para no
    // dejar un cheque huérfano consumiendo folio.
    const { data: pago, error: ePago } = await supabase.from('pagos_cuenta').insert({
      cuenta_id: cuenta.id,
      monto,
      fecha_pago: formCheque.fecha,
      medio_pago: 'cheque',
      chequera_detalle_id: detalle.id,
      comentario: `Cheque N°${folio} generado`,
      estado: 'pagado',
    }).select('id').single()

    if (ePago) {
      await supabase.from('chequera_detalle').delete().eq('id', detalle.id)
      setSavingCheque(false)
      showToast('Error al registrar el pago; el cheque fue revertido: ' + ePago.message, 'error')
      loadAll()
      return
    }

    const rec = await recalcularCuenta(cuenta.id)
    if (rec.error) {
      await supabase.from('pagos_cuenta').delete().eq('id', pago.id)
      await supabase.from('chequera_detalle').delete().eq('id', detalle.id)
      setSavingCheque(false)
      showToast('Error al actualizar la cuenta; el cheque fue revertido: ' + rec.error.message, 'error')
      loadAll()
      return
    }

    setSavingCheque(false)
    setChequeCuentaId(null)
    showToast(`Cheque N°${folio} generado y pago registrado`)
    loadAll()
  }

  // ── Convertir pago programado en cheque ────────────────
  const handleGenerarChequeDePagoProgramado = async (cuenta, pago) => {
    if (!confirm(`¿Generar cheque por ${formatearMontoConSimbolo(pago.monto)} para ${cuenta.proveedores?.nombre || 'proveedor'}?`)) return

    const est = await leerEstadoCuenta(cuenta.id)
    if (est.error) { showToast('Error al leer la cuenta: ' + est.error.message, 'error'); return }
    if (pago.monto > est.saldo) {
      showToast(`La cuota (${formatearMontoConSimbolo(pago.monto)}) excede el saldo de la cuenta (${formatearMontoConSimbolo(est.saldo)})`, 'error')
      return
    }

    const cheq = await obtenerChequeraYFolio()
    if (cheq.error) { showToast(cheq.error.message, 'error'); return }
    const { chequera, folio } = cheq

    const { data: detalle, error: eDet } = await supabase.from('chequera_detalle').insert({
      chequera_id: chequera.id,
      folio,
      fecha: pago.fecha_pago,
      beneficiario: cuenta.proveedores?.nombre || '',
      concepto: cuenta.concepto,
      categoria: cuenta.categoria || CATEGORIA_DEFAULT,
      monto: pago.monto,
      estado: 'emitido',
    }).select().single()
    if (eDet) { showToast('Error generando cheque: ' + eDet.message, 'error'); return }

    const { error: eUpd } = await supabase.from('pagos_cuenta').update({
      chequera_detalle_id: detalle.id,
      estado: 'pagado',
      comentario: `Cheque N°${folio} generado desde pago programado`,
    }).eq('id', pago.id)

    if (eUpd) {
      await supabase.from('chequera_detalle').delete().eq('id', detalle.id)
      showToast('Error al vincular la cuota; el cheque fue revertido: ' + eUpd.message, 'error')
      loadAll()
      return
    }

    const rec = await recalcularCuenta(cuenta.id)
    if (rec.error) {
      await revertirPagosAProgramado([pago])
      await supabase.from('chequera_detalle').delete().eq('id', detalle.id)
      showToast('Error al actualizar la cuenta; el cheque fue revertido: ' + rec.error.message, 'error')
      loadAll()
      return
    }

    showToast(`Cheque N°${folio} generado`)
    loadAll()
  }

  // ── Un cheque por varias cuotas programadas ────────────
  // Devuelve las cuotas a su estado original: 'programado', sin cheque y con su
  // fecha_pago y comentario previos. Se usa como compensación.
  const revertirPagosAProgramado = async (pagosOriginales) => {
    for (const p of pagosOriginales) {
      await supabase.from('pagos_cuenta').update({
        estado: 'programado',
        chequera_detalle_id: null,
        fecha_pago: p.fecha_pago,
        comentario: p.comentario || null,
      }).eq('id', p.id)
    }
  }

  const cuotasSeleccionadasDe = (cuentaId) =>
    pagosDe(cuentaId).filter(p => p.estado === 'programado' && cuotasSel[p.id])

  const abrirChequeCuotas = (cuenta) => {
    const sel = cuotasSeleccionadasDe(cuenta.id)
    if (sel.length === 0) return
    const fechas = sel.map(p => formatearFechaCorta(p.fecha_pago)).join(', ')
    setFormChequeCuotas({ concepto: `${cuenta.concepto} — cuotas ${fechas}`, fecha: hoyStr() })
    setChequeCuotasCuentaId(cuenta.id)
  }

  const handleGenerarChequeDeCuotas = async () => {
    const cuenta = cuentaChequeCuotas
    if (!cuenta) return

    const seleccionados = cuotasSeleccionadasDe(cuenta.id)
    if (seleccionados.length === 0) { showToast('Selecciona al menos una cuota', 'error'); return }
    const monto = seleccionados.reduce((s, p) => s + (p.monto || 0), 0)
    if (monto <= 0) { showToast('Monto inválido', 'error'); return }

    setSavingChequeCuotas(true)

    const est = await leerEstadoCuenta(cuenta.id)
    if (est.error) { setSavingChequeCuotas(false); showToast('Error al leer la cuenta: ' + est.error.message, 'error'); return }
    if (monto > est.saldo) {
      setSavingChequeCuotas(false)
      showToast(`El total seleccionado (${formatearMontoConSimbolo(monto)}) excede el saldo de la cuenta (${formatearMontoConSimbolo(est.saldo)})`, 'error')
      return
    }

    const cheq = await obtenerChequeraYFolio()
    if (cheq.error) { setSavingChequeCuotas(false); showToast(cheq.error.message, 'error'); return }
    const { chequera, folio } = cheq

    // UN cheque por la suma de las cuotas. El banco lo cobrará como un solo
    // cargo, así que el calce con la cartola (un cargo ↔ un cheque) sigue igual.
    const { data: detalle, error: eDet } = await supabase.from('chequera_detalle').insert({
      chequera_id: chequera.id,
      folio,
      fecha: formChequeCuotas.fecha,
      beneficiario: cuenta.proveedores?.nombre || '',
      concepto: formChequeCuotas.concepto || cuenta.concepto,
      categoria: cuenta.categoria || CATEGORIA_DEFAULT,
      monto,
      estado: 'emitido',
    }).select().single()
    if (eDet) { setSavingChequeCuotas(false); showToast('Error generando cheque: ' + eDet.message, 'error'); return }

    // Las N cuotas pasan a 'pagado' apuntando al mismo cheque. Se registra cuáles
    // se alcanzaron a marcar para poder revertir exactamente esas si algo falla.
    const marcados = []
    let fallo = null
    for (const p of seleccionados) {
      const { error } = await supabase.from('pagos_cuenta').update({
        estado: 'pagado',
        fecha_pago: formChequeCuotas.fecha,
        chequera_detalle_id: detalle.id,
        comentario: `Cheque N°${folio} — cuota ${formatearFechaCorta(p.fecha_pago)}`,
      }).eq('id', p.id)
      if (error) { fallo = error; break }
      marcados.push(p)
    }

    if (!fallo) {
      const rec = await recalcularCuenta(cuenta.id)
      if (rec.error) fallo = rec.error
    }

    if (fallo) {
      await revertirPagosAProgramado(marcados)
      await supabase.from('chequera_detalle').delete().eq('id', detalle.id)
      await recalcularCuenta(cuenta.id)
      setSavingChequeCuotas(false)
      showToast('Error al vincular las cuotas; el cheque fue revertido: ' + fallo.message, 'error')
      loadAll()
      return
    }

    setSavingChequeCuotas(false)
    setChequeCuotasCuentaId(null)
    setCuotasSel({})
    showToast(`Cheque N°${folio} generado por ${seleccionados.length} cuota(s)`)
    loadAll()
  }

  const handleAnular = async (cuenta) => {
    if (!confirm(`¿Anular la cuenta "${cuenta.concepto}"? Los pagos asociados quedan registrados.`)) return
    const { error } = await supabase.from('cuentas_por_pagar').update({ estado: 'anulada' }).eq('id', cuenta.id)
    if (error) showToast('Error al anular', 'error')
    else { showToast('Cuenta anulada'); loadAll() }
  }

  // ── Respaldos ──────────────────────────────────────────
  const handleSubirRespaldo = async (file, cuentaId) => {
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
      showToast('Formato no permitido. PDF/JPG/PNG.', 'error')
      setUploadingFor(null)
      return
    }
    setUploadingFor(cuentaId)
    const path = `cuentas/${cuentaId}/${Date.now()}_${file.name}`
    const { error: eSt } = await supabase.storage.from('cartolas').upload(path, file)
    if (eSt) { setUploadingFor(null); showToast('Error subiendo archivo', 'error'); return }
    await supabase.from('respaldos_cuenta').insert({
      cuenta_id: cuentaId,
      nombre_archivo: file.name,
      storage_path: path,
      tipo: ext,
    })
    setUploadingFor(null)
    showToast('Respaldo subido')
    loadAll()
  }

  const handleVerRespaldo = async (path) => {
    const { data } = await supabase.storage.from('cartolas').createSignedUrl(path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else showToast('Error obteniendo archivo', 'error')
  }

  const handleDescargarRespaldo = async (path, nombre) => {
    const { data } = await supabase.storage.from('cartolas').createSignedUrl(path, 60)
    if (data?.signedUrl) {
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = nombre
      a.click()
    } else showToast('Error', 'error')
  }

  const handleEliminarRespaldo = async (respaldo) => {
    if (!confirm('¿Eliminar este respaldo?')) return
    await supabase.storage.from('cartolas').remove([respaldo.storage_path])
    await supabase.from('respaldos_cuenta').delete().eq('id', respaldo.id)
    showToast('Respaldo eliminado')
    loadAll()
  }

  // ── Exportar Excel ─────────────────────────────────────
  const handleExportar = async () => {
    if (cuentas.length === 0) { showToast('No hay datos', 'error'); return }
    setExportando(true)
    try {
      const XLSX = await import('xlsx')
      const rows = cuentas.map(c => ({
        'N°': c.numero,
        'Proveedor': c.proveedores?.nombre || '',
        'RUT proveedor': c.proveedores?.rut || '',
        'Concepto': c.concepto,
        'Categoría': c.categoria || '',
        'Fecha emisión': formatearFecha(c.fecha_emision),
        'Fecha vencimiento': formatearFecha(c.fecha_vencimiento),
        'Monto total': c.monto_total,
        'Monto pagado': c.monto_pagado || 0,
        'Saldo': c.monto_total - (c.monto_pagado || 0),
        'Estado': c.estado,
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 14 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Cuentas')
      XLSX.writeFile(wb, `Cuentas_por_pagar_${hoyStr()}.xlsx`)
      showToast('Excel exportado')
    } catch (e) {
      showToast('Error al exportar', 'error')
    }
    setExportando(false)
  }

  // ── Derivados ──────────────────────────────────────────
  const hoy = hoyStr()
  const mes = mesActual()
  const cuentasFiltradas = cuentas.filter(c => {
    if (filtroEstado === 'pendiente' && c.estado !== 'pendiente') return false
    if (filtroEstado === 'parcial' && c.estado !== 'parcial') return false
    if (filtroEstado === 'pagada' && c.estado !== 'pagada') return false
    if (filtroEstado === 'anulada' && c.estado !== 'anulada') return false
    if (filtroEstado === 'vencida') {
      if (!['pendiente', 'parcial'].includes(c.estado)) return false
      if (!c.fecha_vencimiento || c.fecha_vencimiento >= hoy) return false
    }
    const q = busqueda.toLowerCase().trim()
    if (q && !`${c.proveedores?.nombre || ''} ${c.concepto || ''} ${c.numero}`.toLowerCase().includes(q)) return false
    return true
  })

  const stats = {
    pendientes: cuentas.filter(c => c.estado === 'pendiente'),
    parciales: cuentas.filter(c => c.estado === 'parcial'),
    pagadasMes: cuentas.filter(c => c.estado === 'pagada' && c.fecha_emision?.slice(0, 7) === mes),
    vencidas: cuentas.filter(c => ['pendiente', 'parcial'].includes(c.estado) && c.fecha_vencimiento && c.fecha_vencimiento < hoy),
  }
  const sumar = (arr, campo = 'monto_total') => arr.reduce((t, c) => t + (c[campo] || 0), 0)

  const cuentaPago = pagoCuentaId ? cuentas.find(c => c.id === pagoCuentaId) : null
  const cuentaCheque = chequeCuentaId ? cuentas.find(c => c.id === chequeCuentaId) : null
  const cuentaChequeCuotas = chequeCuotasCuentaId ? cuentas.find(c => c.id === chequeCuotasCuentaId) : null

  return (
    <div>
      {ToastComponent}
      <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
        onChange={e => { if (uploadingFor && e.target.files[0]) { handleSubirRespaldo(e.target.files[0], uploadingFor); e.target.value = '' } }} />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: '1.5rem' }}>
        {[
          { label: 'Pendientes', cant: stats.pendientes.length, monto: sumar(stats.pendientes), color: '#f09595' },
          { label: 'Pago parcial', cant: stats.parciales.length, monto: sumar(stats.parciales, 'monto_pagado'), color: '#fac775' },
          { label: 'Pagadas este mes', cant: stats.pagadasMes.length, monto: sumar(stats.pagadasMes), color: '#5dcaa5' },
          { label: 'Vencidas', cant: stats.vencidas.length, monto: sumar(stats.vencidas), color: '#85b7eb' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.cant}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginTop: 4 }}>{formatearMontoConSimbolo(s.monto)}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-file-invoice"></i> Cuentas por pagar ({cuentasFiltradas.length})</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-sm" style={{ color: '#5dcaa5', borderColor: 'rgba(29,158,117,0.4)' }}
              onClick={handleExportar} disabled={exportando}>
              {exportando ? <><i className="ti ti-loader"></i> Exportando…</> : <><i className="ti ti-file-spreadsheet"></i> Excel</>}
            </button>
            {editable && (
              <button className="btn btn-primary btn-sm" onClick={abrirNueva}>
                <i className="ti ti-plus"></i> Nueva cuenta
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: '0.75rem 1.25rem', borderBottom: '0.5px solid var(--border)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { id: 'todos', label: 'Todos' },
              { id: 'pendiente', label: 'Pendientes' },
              { id: 'parcial', label: 'Parcial' },
              { id: 'pagada', label: 'Pagadas' },
              { id: 'vencida', label: 'Vencidas' },
              { id: 'anulada', label: 'Anuladas' },
            ].map(f => (
              <button key={f.id} className={`btn btn-sm${filtroEstado === f.id ? ' btn-primary' : ''}`} onClick={() => setFiltroEstado(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="search-box" style={{ marginLeft: 'auto' }}>
            <i className="ti ti-search"></i>
            <input placeholder="Buscar proveedor o concepto…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
        ) : cuentasFiltradas.length === 0 ? (
          <div className="empty-state"><i className="ti ti-file-off"></i>{cuentas.length === 0 ? 'No hay cuentas por pagar registradas' : 'Sin resultados con este filtro'}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>N°</th><th>Proveedor</th><th>Concepto</th><th>Fecha</th><th>Vence</th>
                <th>Total</th><th>Pagado</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {cuentasFiltradas.map(c => {
                const expanded = expandedId === c.id
                const saldo = c.monto_total - (c.monto_pagado || 0)
                const progreso = c.monto_total > 0 ? Math.min(100, Math.round(((c.monto_pagado || 0) / c.monto_total) * 100)) : 0
                const vencida = ['pendiente', 'parcial'].includes(c.estado) && c.fecha_vencimiento && c.fecha_vencimiento < hoy
                const pagos = pagosDe(c.id)
                const pagosEfectivos = pagos.filter(p => p.estado !== 'programado')
                const pagosProgramados = pagos.filter(p => p.estado === 'programado')
                const respaldos = respaldosDe(c.id)
                return (
                  <React.Fragment key={c.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => { setExpandedId(expanded ? null : c.id); setCuotasSel({}) }}>
                      <td><span className="chip">{String(c.numero || '').padStart(3, '0')}</span></td>
                      <td>
                        <div>{c.proveedores?.nombre || '—'}</div>
                        {c.proveedores?.giro && <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>{c.proveedores.giro}</div>}
                      </td>
                      <td>
                        <div>{c.concepto}</div>
                        {c.categoria && <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>{c.categoria}</div>}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatearFecha(c.fecha_emision)}</td>
                      <td style={{ color: vencida ? '#f09595' : 'var(--text-muted)', fontSize: 12, fontWeight: vencida ? 'bold' : 'normal' }}>{formatearFecha(c.fecha_vencimiento)}</td>
                      <td style={{ color: '#f09595', fontWeight: 'bold' }}>{formatearMontoConSimbolo(c.monto_total)}</td>
                      <td style={{ color: '#5dcaa5' }}>{formatearMontoConSimbolo(c.monto_pagado || 0)}</td>
                      <td>{estadoBadge(c.estado)}</td>
                      <td><i className={`ti ti-chevron-${expanded ? 'up' : 'down'}`} style={{ color: 'var(--text-muted)' }}></i></td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={9} style={{ background: 'rgba(10,22,40,0.4)', padding: '1.25rem 1.5rem' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontFamily: 'sans-serif' }}>Proveedor</div>
                              <div style={{ fontSize: 13 }}>{c.proveedores?.nombre || '—'}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>RUT: {c.proveedores?.rut || '—'}</div>
                              {c.proveedores?.giro && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Giro: {c.proveedores.giro}</div>}
                              {c.descripcion && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{c.descripcion}</div>}
                              {c.comentario && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', fontStyle: 'italic' }}>"{c.comentario}"</div>}
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontFamily: 'sans-serif' }}>Avance de pago</div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                                <span style={{ color: '#5dcaa5' }}>{formatearMontoConSimbolo(c.monto_pagado || 0)}</span>
                                <span style={{ color: 'var(--text-muted)' }}>de {formatearMontoConSimbolo(c.monto_total)}</span>
                                <span style={{ color: saldo > 0 ? '#fac775' : '#5dcaa5' }}>Saldo: <strong>{formatearMontoConSimbolo(saldo)}</strong></span>
                              </div>
                              <div style={{ height: 5, background: 'rgba(201,168,76,0.15)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
                                <div style={{ width: `${progreso}%`, height: '100%', borderRadius: 3, background: c.estado === 'pagada' ? '#5dcaa5' : c.estado === 'parcial' ? '#fac775' : '#f09595', transition: 'width 0.3s' }}></div>
                              </div>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {editable && (
                                  <button className="btn btn-sm" onClick={() => abrirEditarCuenta(c)} title="Editar">
                                    <i className="ti ti-edit"></i> Editar
                                  </button>
                                )}
                                {editable && c.estado !== 'pagada' && c.estado !== 'anulada' && (
                                  <>
                                    <button className="btn btn-sm btn-primary" onClick={() => abrirPago(c)}>
                                      <i className="ti ti-cash"></i> Registrar pago
                                    </button>
                                    <button className="btn btn-sm" style={{ color: '#85b7eb', borderColor: 'rgba(55,138,221,0.4)' }} onClick={() => abrirGenerarCheque(c)}>
                                      <i className="ti ti-writing"></i> Generar cheque
                                    </button>
                                  </>
                                )}
                                {editable && c.estado !== 'anulada' && (
                                  <button className="btn btn-sm btn-danger" onClick={() => handleAnular(c)}>
                                    <i className="ti ti-ban"></i> Anular
                                  </button>
                                )}
                                {editable && (
                                  <button className="btn btn-sm btn-danger" onClick={() => handleEliminarCuenta(c)} title="Eliminar cuenta">
                                    <i className="ti ti-trash"></i> Eliminar
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Respaldos */}
                          <div style={{ marginTop: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif' }}>Respaldos ({respaldos.length})</div>
                              <button className="btn btn-sm" onClick={() => { setUploadingFor(c.id); fileRef.current?.click() }}>
                                {uploadingFor === c.id ? <><i className="ti ti-loader"></i> Subiendo…</> : <><i className="ti ti-upload"></i> Subir</>}
                              </button>
                            </div>
                            {respaldos.length === 0 ? (
                              <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>Sin respaldos adjuntos</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {respaldos.map(r => (
                                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--navy-mid)', borderRadius: 6, fontSize: 12 }}>
                                    <i className="ti ti-file" style={{ color: 'var(--gold-dim)' }}></i>
                                    <span style={{ flex: 1 }}>{r.nombre_archivo}</span>
                                    <button className="btn btn-sm" onClick={() => handleVerRespaldo(r.storage_path)} title="Ver"><i className="ti ti-eye"></i></button>
                                    <button className="btn btn-sm" onClick={() => handleDescargarRespaldo(r.storage_path, r.nombre_archivo)} title="Descargar"><i className="ti ti-download"></i></button>
                                    <button className="btn btn-sm btn-danger" onClick={() => handleEliminarRespaldo(r)} title="Eliminar"><i className="ti ti-trash"></i></button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Historial de pagos */}
                          {pagosEfectivos.length > 0 && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontFamily: 'sans-serif' }}>Historial de pagos ({pagosEfectivos.length})</div>
                              <table>
                                <thead><tr><th>Fecha</th><th>Monto</th><th>Medio</th><th>Cheque</th><th>Comentario</th></tr></thead>
                                <tbody>
                                  {pagosEfectivos.map(p => (
                                    <tr key={p.id}>
                                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatearFecha(p.fecha_pago)}</td>
                                      <td style={{ color: '#5dcaa5', fontWeight: 'bold' }}>{formatearMontoConSimbolo(p.monto)}</td>
                                      <td><span className="chip" style={{ fontSize: 10 }}>{p.medio_pago}</span></td>
                                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.chequera_detalle ? `N°${p.chequera_detalle.folio}` : '—'}</td>
                                      <td style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>{p.comentario || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Pagos programados */}
                          {pagosProgramados.length > 0 && (() => {
                            const sel = pagosProgramados.filter(p => cuotasSel[p.id])
                            const totalSel = sel.reduce((s, p) => s + (p.monto || 0), 0)
                            const excede = totalSel > saldo
                            const todasSel = sel.length === pagosProgramados.length
                            return (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontFamily: 'sans-serif' }}>Pagos programados ({pagosProgramados.length})</div>
                              <table>
                                <thead><tr>
                                  <th style={{ width: 28 }}>
                                    <input type="checkbox" checked={todasSel}
                                      title={todasSel ? 'Deseleccionar todas' : 'Seleccionar todas'}
                                      onChange={e => setCuotasSel(prev => {
                                        const n = { ...prev }
                                        pagosProgramados.forEach(p => { if (e.target.checked) n[p.id] = true; else delete n[p.id] })
                                        return n
                                      })} />
                                  </th>
                                  <th>Fecha</th><th>Monto</th><th>Medio</th><th></th>
                                </tr></thead>
                                <tbody>
                                  {pagosProgramados.map(p => (
                                    <tr key={p.id}>
                                      <td>
                                        <input type="checkbox" checked={!!cuotasSel[p.id]}
                                          onChange={e => setCuotasSel(prev => {
                                            const n = { ...prev }
                                            if (e.target.checked) n[p.id] = true; else delete n[p.id]
                                            return n
                                          })} />
                                      </td>
                                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatearFecha(p.fecha_pago)}</td>
                                      <td style={{ color: '#fac775', fontWeight: 'bold' }}>{formatearMontoConSimbolo(p.monto)}</td>
                                      <td><span className="chip" style={{ fontSize: 10 }}>{p.medio_pago}</span></td>
                                      <td>
                                        <button className="btn btn-sm" style={{ color: '#85b7eb', borderColor: 'rgba(55,138,221,0.4)' }} onClick={() => handleGenerarChequeDePagoProgramado(c, p)}>
                                          <i className="ti ti-writing"></i> Generar cheque
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {editable && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                                  <button className="btn btn-sm" disabled={sel.length === 0 || excede}
                                    style={{ color: sel.length === 0 || excede ? undefined : '#85b7eb', borderColor: sel.length === 0 || excede ? undefined : 'rgba(55,138,221,0.4)' }}
                                    onClick={() => abrirChequeCuotas(c)}>
                                    <i className="ti ti-writing"></i> Generar cheque por seleccionadas
                                    {sel.length > 0 && ` (${sel.length} cuota${sel.length === 1 ? '' : 's'} · ${formatearMontoConSimbolo(totalSel)})`}
                                  </button>
                                  {excede && (
                                    <span style={{ fontSize: 11, color: '#f09595', fontFamily: 'sans-serif' }}>
                                      El total seleccionado excede el saldo de la cuenta ({formatearMontoConSimbolo(saldo)})
                                    </span>
                                  )}
                                  {sel.length === 0 && (
                                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
                                      Marca cuotas para juntarlas en un solo cheque
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            )
                          })()}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal Nueva cuenta */}
      {showNueva && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowNueva(false)}>
          <div className="modal" style={{ width: 680, maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <div className="modal-title">{editCuentaId ? 'Editar cuenta por pagar' : 'Nueva cuenta por pagar'}</div>
              <button className="btn btn-sm" onClick={() => setShowNueva(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Proveedor *</label>
                <select value={formNueva.proveedor_id} onChange={e => setFormNueva(f => ({ ...f, proveedor_id: e.target.value }))}>
                  <option value="">Seleccionar…</option>
                  {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div className="form-group"><label>Categoría *</label>
                <select value={formNueva.categoria} onChange={e => setFormNueva(f => ({ ...f, categoria: e.target.value }))}>
                  {planCuentasGasto.map(pc => <option key={pc.id} value={pc.nombre}>{pc.nombre.trim()}</option>)}
                </select>
              </div>
              <div className="form-group full"><label>Concepto *</label>
                <input placeholder="Ej: Factura mantención octubre" value={formNueva.concepto} onChange={e => setFormNueva(f => ({ ...f, concepto: e.target.value }))} />
              </div>
              <div className="form-group full"><label>Descripción</label>
                <textarea rows={2} value={formNueva.descripcion} onChange={e => setFormNueva(f => ({ ...f, descripcion: e.target.value }))} style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }} />
              </div>
              {(() => {
                const cuentaEdit = editCuentaId ? cuentas.find(c => c.id === editCuentaId) : null
                const bloqueado = !!(cuentaEdit && (cuentaEdit.monto_pagado || 0) > 0)
                return (
                  <div className="form-group"><label>Monto total ($) *</label>
                    <input type="text" inputMode="numeric" value={montoNueva}
                      onChange={e => onChangeMontoNueva(e.target.value)}
                      onBlur={() => { const n = parsearMonto(montoNueva); if (n > 0) setMontoNueva(formatearMonto(n)) }}
                      onFocus={() => { const n = parsearMonto(montoNueva); if (n > 0) setMontoNueva(String(n)) }}
                      placeholder="150.000" disabled={bloqueado} />
                    {bloqueado && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, fontFamily: 'sans-serif' }}>
                        No se puede modificar el monto de una cuenta con pagos registrados
                      </div>
                    )}
                  </div>
                )
              })()}
              <div className="form-group"><label>Fecha emisión</label>
                <input type="date" value={formNueva.fecha_emision} onChange={e => {
                  const v = e.target.value
                  setFormNueva(f => ({ ...f, fecha_emision: v }))
                  if (enCuotas) regenerarCuotas(parsearMonto(montoNueva), nCuotas, v)
                }} />
              </div>
              <div className="form-group"><label>Fecha vencimiento</label>
                <input type="date" value={formNueva.fecha_vencimiento} onChange={e => setFormNueva(f => ({ ...f, fecha_vencimiento: e.target.value }))} />
              </div>
              <div className="form-group"><label>Comentario</label>
                <input value={formNueva.comentario} onChange={e => setFormNueva(f => ({ ...f, comentario: e.target.value }))} />
              </div>

              {!editCuentaId && (<div className="form-group full" style={{ borderTop: '0.5px solid var(--border)', paddingTop: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={enCuotas} onChange={e => onToggleCuotas(e.target.checked)} style={{ accentColor: 'var(--gold)' }} />
                  ¿Pagar en cuotas?
                </label>
              </div>)}
              {!editCuentaId && enCuotas && (
                <>
                  <div className="form-group"><label>N° de cuotas</label>
                    <input type="number" min="1" max="24" value={nCuotas} onChange={e => onChangeNCuotas(e.target.value)} />
                  </div>
                  <div className="form-group full">
                    {cuotasProgramadas.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1 }}>Cuotas programadas</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr', gap: 6, alignItems: 'center' }}>
                          {cuotasProgramadas.map((cu, idx) => (
                            <React.Fragment key={idx}>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Cuota {idx + 1}</div>
                              <input type="date" value={cu.fecha} onChange={e => actualizarCuota(idx, 'fecha', e.target.value)} />
                              <input type="text" value={cu.monto}
                                onChange={e => actualizarCuota(idx, 'monto', e.target.value)}
                                onBlur={() => { const n = parsearMonto(cu.monto); if (n > 0) actualizarCuota(idx, 'monto', formatearMonto(n)) }}
                              />
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowNueva(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleGuardarCuenta} disabled={savingNueva}>
                {savingNueva ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editCuentaId ? 'Guardar cambios' : 'Crear cuenta'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Registrar pago */}
      {cuentaPago && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setPagoCuentaId(null)}>
          <div className="modal" style={{ width: 500 }}>
            <div className="modal-header">
              <div className="modal-title">Registrar pago — {cuentaPago.concepto}</div>
              <button className="btn btn-sm" onClick={() => setPagoCuentaId(null)}><i className="ti ti-x"></i></button>
            </div>
            <div style={{ padding: '0 1.25rem 0.5rem', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
              Proveedor: <strong>{cuentaPago.proveedores?.nombre}</strong> · Saldo: <strong style={{ color: '#fac775' }}>{formatearMontoConSimbolo(cuentaPago.monto_total - (cuentaPago.monto_pagado || 0))}</strong>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Monto a pagar ($) *</label>
                <input type="text" inputMode="numeric" value={montoPago}
                  onChange={e => setMontoPago(e.target.value)}
                  onBlur={() => { const n = parsearMonto(montoPago); if (n > 0) setMontoPago(formatearMonto(n)) }}
                  onFocus={() => { const n = parsearMonto(montoPago); if (n > 0) setMontoPago(String(n)) }} />
              </div>
              <div className="form-group"><label>Fecha de pago</label>
                <input type="date" value={formPago.fecha_pago} onChange={e => setFormPago(f => ({ ...f, fecha_pago: e.target.value }))} />
              </div>
              <div className="form-group"><label>Medio de pago</label>
                <select value={formPago.medio_pago} onChange={e => setFormPago(f => ({ ...f, medio_pago: e.target.value, chequera_detalle_id: '' }))}>
                  {MEDIOS_PAGO.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              {formPago.medio_pago === 'cheque' && (
                <div className="form-group"><label>Cheque emitido (opcional)</label>
                  <select value={formPago.chequera_detalle_id} onChange={e => setFormPago(f => ({ ...f, chequera_detalle_id: e.target.value }))}>
                    <option value="">Sin vincular</option>
                    {chequesEmitidos.filter(c => c.estado === 'emitido').map(c => (
                      <option key={c.id} value={c.id}>N°{c.folio} — {formatearMontoConSimbolo(c.monto)} · {c.beneficiario || '—'}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group full"><label>Comentario{formPago.medio_pago === 'canje' ? ' *' : ''}</label>
                <input value={formPago.comentario}
                  placeholder={formPago.medio_pago === 'canje' ? PLACEHOLDER_CANJE : ''}
                  onChange={e => setFormPago(f => ({ ...f, comentario: e.target.value }))} />
                {formPago.medio_pago === 'canje' && (
                  <div style={{ fontSize: 11, color: '#fac775', fontFamily: 'sans-serif', marginTop: 4 }}>
                    <i className="ti ti-info-circle"></i> El canje no genera movimiento bancario: este comentario es su único respaldo.
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setPagoCuentaId(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleRegistrarPago} disabled={savingPago}>
                {savingPago ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Registrar pago</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Generar cheque */}
      {cuentaCheque && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setChequeCuentaId(null)}>
          <div className="modal" style={{ width: 500 }}>
            <div className="modal-header">
              <div className="modal-title">Generar cheque</div>
              <button className="btn btn-sm" onClick={() => setChequeCuentaId(null)}><i className="ti ti-x"></i></button>
            </div>
            <div style={{ padding: '0 1.25rem 0.5rem', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
              Beneficiario: <strong>{cuentaCheque.proveedores?.nombre || '—'}</strong>
              {cuentaCheque.proveedores?.rut && <> · RUT: <strong>{cuentaCheque.proveedores.rut}</strong></>}
              <div style={{ marginTop: 4 }}>Saldo cuenta: <strong style={{ color: '#fac775' }}>{formatearMontoConSimbolo(cuentaCheque.monto_total - (cuentaCheque.monto_pagado || 0))}</strong></div>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Monto ($) *</label>
                <input type="text" inputMode="numeric" value={montoCheque}
                  onChange={e => setMontoCheque(e.target.value)}
                  onBlur={() => { const n = parsearMonto(montoCheque); if (n > 0) setMontoCheque(formatearMonto(n)) }}
                  onFocus={() => { const n = parsearMonto(montoCheque); if (n > 0) setMontoCheque(String(n)) }} />
              </div>
              <div className="form-group"><label>Fecha</label>
                <input type="date" value={formCheque.fecha} onChange={e => setFormCheque(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div className="form-group full"><label>Concepto</label>
                <input value={formCheque.concepto} onChange={e => setFormCheque(f => ({ ...f, concepto: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setChequeCuentaId(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleGenerarCheque} disabled={savingCheque}>
                {savingCheque ? <><i className="ti ti-loader"></i> Generando…</> : <><i className="ti ti-writing"></i> Generar cheque</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Generar cheque por cuotas seleccionadas */}
      {cuentaChequeCuotas && (() => {
        const sel = cuotasSeleccionadasDe(cuentaChequeCuotas.id)
        const totalSel = sel.reduce((s, p) => s + (p.monto || 0), 0)
        const saldoCuenta = cuentaChequeCuotas.monto_total - (cuentaChequeCuotas.monto_pagado || 0)
        return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setChequeCuotasCuentaId(null)}>
          <div className="modal" style={{ width: 540 }}>
            <div className="modal-header">
              <div className="modal-title">Generar cheque por {sel.length} cuota{sel.length === 1 ? '' : 's'}</div>
              <button className="btn btn-sm" onClick={() => setChequeCuotasCuentaId(null)}><i className="ti ti-x"></i></button>
            </div>
            <div style={{ padding: '0 1.25rem 0.5rem', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
              Beneficiario: <strong>{cuentaChequeCuotas.proveedores?.nombre || '—'}</strong>
              {cuentaChequeCuotas.proveedores?.rut && <> · RUT: <strong>{cuentaChequeCuotas.proveedores.rut}</strong></>}
              <div style={{ marginTop: 4 }}>Saldo cuenta: <strong style={{ color: '#fac775' }}>{formatearMontoConSimbolo(saldoCuenta)}</strong></div>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {sel.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>Cuota {formatearFecha(p.fecha_pago)}</span>
                    <span style={{ color: '#fac775' }}>{formatearMontoConSimbolo(p.monto)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4, fontWeight: 'bold' }}>
                  <span>Total del cheque</span>
                  <span style={{ color: '#5dcaa5' }}>{formatearMontoConSimbolo(totalSel)}</span>
                </div>
              </div>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Fecha del cheque</label>
                <input type="date" value={formChequeCuotas.fecha} onChange={e => setFormChequeCuotas(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div className="form-group full"><label>Concepto</label>
                <input value={formChequeCuotas.concepto} onChange={e => setFormChequeCuotas(f => ({ ...f, concepto: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setChequeCuotasCuentaId(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleGenerarChequeDeCuotas}
                disabled={savingChequeCuotas || sel.length === 0 || totalSel > saldoCuenta}>
                {savingChequeCuotas ? <><i className="ti ti-loader"></i> Generando…</> : <><i className="ti ti-writing"></i> Generar cheque por {formatearMontoConSimbolo(totalSel)}</>}
              </button>
            </div>
          </div>
        </div>
        )
      })()}
    </div>
  )
}
