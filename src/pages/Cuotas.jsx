import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import { formatearMontoConSimbolo, parsearMonto, formatearMonto } from '../lib/montos'

const FORMAS_PAGO = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'otro', label: 'Otro' },
]

export default function Cuotas() {
  const { showToast, ToastComponent } = useToast()
  const { user, puedeEditar } = useAuth()
  const editable = puedeEditar('cuotas')
  const esSocio = user?.rol === 'socio'
  const miSocioId = user?.socio_id
  const [periodos, setPeriodos] = useState([])
  const [selectedPeriodo, setSelectedPeriodo] = useState(null)
  const [socios, setSocios] = useState([])
  const [pagos, setPagos] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModalPeriodo, setShowModalPeriodo] = useState(false)
  const [showModalPago, setShowModalPago] = useState(false)
  const [selectedSocio, setSelectedSocio] = useState(null)
  const [cheques, setCheques] = useState([])
  const [formPeriodo, setFormPeriodo] = useState({ anio: new Date().getFullYear(), monto: '', descripcion: '' })
  const [formPago, setFormPago] = useState({ monto: '', fecha_pago: new Date().toISOString().slice(0,10), forma_pago: 'transferencia', cheque_id: '', comentario: '' })
  const [saving, setSaving] = useState(false)
  const [filtroSocio, setFiltroSocio] = useState('')
  const [detalleSocioId, setDetalleSocioId] = useState(null)
  const [editPago, setEditPago] = useState(null)
  const [exportando, setExportando] = useState(false)
  const [misCheques, setMisCheques] = useState([])
  const [pagosTodos, setPagosTodos] = useState([])

  useEffect(() => {
    loadPeriodos()
    supabase.from('cheques').select('id,numero,monto,estado,concepto,fecha_deposito,fecha_documento').eq('estado','por_depositar').eq('concepto','cuota_social').then(({ data }) => setCheques(data || []))
  }, [])

  useEffect(() => {
    if (!esSocio || !miSocioId) { setMisCheques([]); return }
    supabase.from('cheques').select('*').eq('socio_id', miSocioId).then(({ data }) => {
      // Orden por fecha efectiva (fecha_deposito ?? fecha_documento), ascendente, nulls al final.
      const ef = (c) => c.fecha_deposito || c.fecha_documento || ''
      const ordenados = (data || []).slice().sort((a, b) => {
        const fa = ef(a), fb = ef(b)
        if (fa && fb) return fa < fb ? -1 : fa > fb ? 1 : 0
        if (fa) return -1
        if (fb) return 1
        return 0
      })
      setMisCheques(ordenados)
    })
  }, [esSocio, miSocioId])

  const loadSocios = async () => {
    if (!selectedPeriodo) return
    const anio = selectedPeriodo.anio
    let query = supabase
      .from('socios')
      .select('id,nombre,apellido,numero_socio,fecha_ingreso,fecha_inactividad,estado')
      .lte('fecha_ingreso', `${anio}-12-31`)
      .order('numero_socio')
    if (esSocio && miSocioId) query = query.eq('id', miSocioId)
    const { data } = await query
    const filtrados = (data || []).filter(s => {
      if (s.estado === 'inactivo' && s.fecha_inactividad) {
        const anioInactividad = parseInt(s.fecha_inactividad.slice(0, 4))
        if (anioInactividad < anio) return false
      }
      return true
    })
    setSocios(filtrados)
  }

  useEffect(() => { loadSocios() }, [selectedPeriodo])

  const handleCambiarEstadoSocio = async (s, nuevoEstado) => {
    const estadoAnterior = s.estado
    if (estadoAnterior === nuevoEstado) return
    const { error } = await supabase.from('socios').update({ estado: nuevoEstado }).eq('id', s.id)
    if (error) { showToast('Error al cambiar estado: ' + error.message, 'error'); return }

    let extra = ''
    if (nuevoEstado === 'inactivo' && estadoAnterior !== 'inactivo') {
      const { data: benes } = await supabase.from('beneficiarios').select('id,estado').eq('socio_id', s.id)
      for (const b of (benes || [])) {
        await supabase.from('beneficiarios').update({ estado_previo: b.estado, estado: 'inactivo' }).eq('id', b.id)
      }
      if (benes?.length) extra = ` · ${benes.length} beneficiario(s) desactivado(s)`
    } else if (nuevoEstado === 'activo' && estadoAnterior === 'inactivo') {
      const { data: benes } = await supabase.from('beneficiarios').select('id,estado_previo').eq('socio_id', s.id)
      for (const b of (benes || [])) {
        await supabase.from('beneficiarios').update({ estado: b.estado_previo || 'vigente', estado_previo: null }).eq('id', b.id)
      }
      if (benes?.length) extra = ` · ${benes.length} beneficiario(s) restaurado(s)`
    }
    showToast(`${s.nombre} ${s.apellido} → ${nuevoEstado}${extra}`)
    loadSocios()
  }

  useEffect(() => { if (selectedPeriodo) loadPagos(selectedPeriodo.id) }, [selectedPeriodo])

  useEffect(() => {
    let q = supabase.from('pagos_cuota').select('socio_id,periodo_id,monto')
    if (esSocio && miSocioId) q = q.eq('socio_id', miSocioId)
    q.then(({ data }) => setPagosTodos(data || []))
  }, [esSocio, miSocioId, pagos])

  const esPagoCuota = (p) => !p.concepto || p.concepto.toLowerCase().includes('cuota')

  const calcularDeudaConsolidada = (socioId) => {
    const socio = socios.find(s => s.id === socioId)
    const anioIngreso = socio?.fecha_ingreso ? parseInt(socio.fecha_ingreso.slice(0, 4)) : null
    const rows = []
    for (const p of periodos) {
      if (anioIngreso && p.anio < anioIngreso) continue
      const pagosPer = pagosTodos.filter(pg => pg.socio_id === socioId && pg.periodo_id === p.id && esPagoCuota(pg))
      const totalPagado = pagosPer.reduce((t, pg) => t + pg.monto, 0)
      const pendiente = Math.max(0, p.monto - totalPagado)
      rows.push({
        anio: p.anio,
        cuota: p.monto,
        pagado: totalPagado,
        pendiente,
        pct: p.monto > 0 ? Math.round((totalPagado / p.monto) * 100) : 0,
        estado: totalPagado >= p.monto ? 'al_dia' : totalPagado > 0 ? 'parcial' : 'sin_pago',
      })
    }
    return rows.sort((a, b) => a.anio - b.anio)
  }

  const deudaHistoricaSocio = (socioId) => {
    if (!selectedPeriodo) return { monto: 0, detalle: [] }
    const consolidada = calcularDeudaConsolidada(socioId)
    const previos = consolidada.filter(r => r.anio < selectedPeriodo.anio && r.pendiente > 0)
    return { monto: previos.reduce((t, r) => t + r.pendiente, 0), detalle: previos }
  }

  const loadPeriodos = async () => {
    const { data } = await supabase.from('periodos_cuota').select('*').order('anio', { ascending: false })
    setPeriodos(data || [])
    if (data?.length > 0) setSelectedPeriodo(data[0])
  }

  const loadPagos = async (periodoId) => {
    setLoading(true)
    const { data } = await supabase
      .from('pagos_cuota')
      .select('*, socios(nombre,apellido,numero_socio), cheques(id,numero,fecha_deposito,fecha_documento,estado), movimientos(descripcion)')
      .eq('periodo_id', periodoId)
      .order('fecha_pago', { ascending: false })
    setPagos(data || [])
    setLoading(false)
  }

  const pagosPorSocio = socios.reduce((acc, s) => {
    const sp = pagos.filter(p => p.socio_id === s.id)
    // total cuenta solo cuota social (excluye incorporación) para comparar contra montoAnual
    const total = sp.filter(esPagoCuota).reduce((t, p) => t + p.monto, 0)
    acc[s.id] = { pagos: sp, total }
    return acc
  }, {})

  // Los socios ya vienen filtrados por el período desde Supabase
  const sociosDelPeriodo = socios

  const totalRecaudado = pagos.reduce((t, p) => t + p.monto, 0)
  const montoAnual = selectedPeriodo?.monto || 0
  const sociosConPago = sociosDelPeriodo.filter(s => (pagosPorSocio[s.id]?.total || 0) > 0).length

  const handleCrearPeriodo = async () => {
    if (!formPeriodo.anio || !formPeriodo.monto) { showToast('Año y monto son obligatorios', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('periodos_cuota').insert({
      anio: parseInt(formPeriodo.anio),
      monto: parseInt(formPeriodo.monto),
      descripcion: formPeriodo.descripcion,
    })
    setSaving(false)
    if (error) showToast(error.message.includes('unique') ? 'Ya existe un período para ese año' : 'Error al crear período', 'error')
    else { showToast('Período creado'); setShowModalPeriodo(false); loadPeriodos() }
  }

  const openRegistrarPago = (socio) => {
    setSelectedSocio(socio)
    const restante = montoAnual - (pagosPorSocio[socio.id]?.total || 0)
    setFormPago({ monto: restante > 0 ? restante : '', fecha_pago: new Date().toISOString().slice(0,10), forma_pago: 'transferencia', cheque_id: '', comentario: '' })
    setShowModalPago(true)
  }

  const handleRegistrarPago = async () => {
    if (!formPago.monto || !formPago.fecha_pago) { showToast('Monto y fecha son obligatorios', 'error'); return }

    const fechaPago = new Date(formPago.fecha_pago + 'T00:00:00')
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    if (fechaPago > hoy) {
      const [y, m, d] = formPago.fecha_pago.split('-')
      if (!confirm(`La fecha del pago es ${d}/${m}/${y} (posterior a hoy). ¿Confirmás que es correcta?`)) return
    }

    setSaving(true)
    const payload = {
      socio_id: selectedSocio.id,
      periodo_id: selectedPeriodo.id,
      monto: parseInt(formPago.monto),
      fecha_pago: formPago.fecha_pago,
      forma_pago: formPago.forma_pago,
      cheque_id: formPago.cheque_id || null,
      comentario: formPago.comentario,
    }
    const { error } = await supabase.from('pagos_cuota').insert(payload)
    setSaving(false)
    if (error) showToast('Error al registrar pago', 'error')
    else { showToast('Pago registrado'); setShowModalPago(false); loadPagos(selectedPeriodo.id) }
  }

  const handleEliminarPago = async (id) => {
    if (!confirm('¿Eliminar este pago?')) return
    const { error } = await supabase.from('pagos_cuota').delete().eq('id', id)
    if (error) showToast('Error al eliminar', 'error')
    else { showToast('Pago eliminado'); loadPagos(selectedPeriodo.id) }
  }

  const handleGuardarEditPago = async () => {
    if (!editPago.monto || !editPago.fecha_pago) { showToast('Monto y fecha son obligatorios', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('pagos_cuota').update({
      monto: parsearMonto(editPago.monto),
      fecha_pago: editPago.fecha_pago,
      forma_pago: editPago.forma_pago,
      comentario: editPago.comentario,
    }).eq('id', editPago.id)
    setSaving(false)
    if (error) showToast('Error al guardar', 'error')
    else { showToast('Pago actualizado'); setEditPago(null); loadPagos(selectedPeriodo.id) }
  }

  const handleExportar = async () => {
    if (!selectedPeriodo || sociosFiltrados.length === 0) { showToast('No hay datos para exportar', 'error'); return }
    setExportando(true)
    try {
      const XLSX = await import('xlsx')
      const rows = sociosFiltrados.map(s => {
        const sp = pagosPorSocio[s.id]
        const total = sp?.total || 0
        const pendiente = Math.max(0, montoAnual - total)
        const pct = montoAnual > 0 ? Math.round((total / montoAnual) * 100) : 0
        const ultimoPago = sp?.pagos?.[sp.pagos.length - 1]
        return {
          'N° Socio': s.numero_socio,
          'Nombre': s.nombre,
          'Apellido': s.apellido,
          'Estado socio': s.estado,
          'Total pagado': total,
          'Pendiente': pendiente,
          '% pagado': pct,
          'Estado cuota': total === 0 ? 'Sin pago' : total >= montoAnual ? 'Al día' : `Parcial (${pct}%)`,
          'Última fecha pago': ultimoPago?.fecha_pago ? ultimoPago.fecha_pago.split('-').reverse().join('/') : '—',
          'N° pagos': sp?.pagos?.length || 0,
        }
      })
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [{ wch: 10 },{ wch: 18 },{ wch: 20 },{ wch: 12 },{ wch: 14 },{ wch: 12 },{ wch: 10 },{ wch: 16 },{ wch: 16 },{ wch: 10 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, `Cuotas ${selectedPeriodo.anio}`)
      XLSX.writeFile(wb, `Cuotas_${selectedPeriodo.anio}.xlsx`)
      showToast('Excel exportado correctamente')
    } catch (e) {
      showToast('Error al exportar', 'error')
    }
    setExportando(false)
  }

  const sociosFiltrados = sociosDelPeriodo.filter(s =>
    `${s.nombre} ${s.apellido} ${s.numero_socio}`.toLowerCase().includes(filtroSocio.toLowerCase())
  )

  const FP = (key) => ({ value: formPago[key] || '', onChange: e => setFormPago(f => ({ ...f, [key]: e.target.value })) })

  return (
    <div>
      {ToastComponent}

      {/* Aviso para socios sin vinculación */}
      {esSocio && !miSocioId && (
        <div className="empty-state">
          <i className="ti ti-alert-circle"></i>
          Tu cuenta no está vinculada a un socio. Contacta al administrador.
        </div>
      )}

      {/* Deuda consolidada (solo socio) */}
      {esSocio && miSocioId && (() => {
        const consolidada = calcularDeudaConsolidada(miSocioId)
        const conDeuda = consolidada.some(r => r.pendiente > 0)
        if (!conDeuda) return null
        const totalDeuda = consolidada.reduce((t, r) => t + r.pendiente, 0)
        const totalPagado = consolidada.reduce((t, r) => t + r.pagado, 0)
        const totalComprometido = consolidada.reduce((t, r) => t + r.cuota, 0)
        const aniosConDeuda = consolidada.filter(r => r.pendiente > 0).length
        return (
          <div className="card" style={{ borderLeft: '3px solid #fac775', marginBottom: '1rem' }}>
            <div className="card-header">
              <div className="card-title" style={{ color: '#fac775' }}>
                <i className="ti ti-alert-triangle"></i> Resumen de deuda consolidada
              </div>
              <span className="badge badge-pending">Tienes cuotas pendientes</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, padding: '1rem 1.25rem', borderBottom: '0.5px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Deuda total</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: '#f09595' }}>{formatearMontoConSimbolo(totalDeuda)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Años con deuda</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: '#fac775' }}>{aniosConDeuda}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Total pagado</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: '#5dcaa5' }}>{formatearMontoConSimbolo(totalPagado)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Total comprometido</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--gold-light)' }}>{formatearMontoConSimbolo(totalComprometido)}</div>
              </div>
            </div>
            <table>
              <thead>
                <tr><th>Año</th><th>Cuota</th><th>Pagado</th><th>Pendiente</th><th>Avance</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {consolidada.map(r => {
                  const bg = r.estado === 'sin_pago' ? 'rgba(240,149,149,0.05)' : r.estado === 'parcial' ? 'rgba(250,199,117,0.05)' : 'transparent'
                  const barColor = r.pct === 0 ? '#f09595' : r.pct >= 100 ? '#5dcaa5' : '#fac775'
                  return (
                    <tr key={r.anio} style={{ background: bg }}>
                      <td style={{ fontWeight: 500 }}>{r.anio}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{formatearMontoConSimbolo(r.cuota)}</td>
                      <td style={{ color: '#5dcaa5' }}>{formatearMontoConSimbolo(r.pagado)}</td>
                      <td style={{ color: r.estado === 'sin_pago' ? '#f09595' : r.estado === 'parcial' ? '#fac775' : 'var(--text-muted)', fontWeight: r.pendiente > 0 ? 'bold' : 'normal' }}>
                        {r.pendiente > 0 ? formatearMontoConSimbolo(r.pendiente) : '—'}
                      </td>
                      <td style={{ width: 160 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 5, background: 'rgba(201,168,76,0.15)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, r.pct)}%`, height: '100%', background: barColor, transition: 'width 0.3s' }}></div>
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', minWidth: 32 }}>{r.pct}%</span>
                        </div>
                      </td>
                      <td>
                        {r.estado === 'al_dia' && <span className="badge badge-active">Al día</span>}
                        {r.estado === 'parcial' && <span className="badge badge-pending">Parcial</span>}
                        {r.estado === 'sin_pago' && <span className="badge badge-inactive">Sin pago</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'rgba(10,22,40,0.4)', fontWeight: 'bold' }}>
                  <td>Total</td>
                  <td>{formatearMontoConSimbolo(totalComprometido)}</td>
                  <td style={{ color: '#5dcaa5' }}>{formatearMontoConSimbolo(totalPagado)}</td>
                  <td style={{ color: '#f09595' }}>{formatearMontoConSimbolo(totalDeuda)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      })()}

      {/* Selector de período */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Período:</label>
          <select value={selectedPeriodo?.id || ''} onChange={e => setSelectedPeriodo(periodos.find(p => p.id === e.target.value))} style={{ width: 'auto' }}>
            {periodos.map(p => <option key={p.id} value={p.id}>{p.anio} — ${p.monto.toLocaleString('es-CL')}</option>)}
          </select>
        </div>
        {editable && <button className="btn btn-primary" onClick={() => setShowModalPeriodo(true)}>
          <i className="ti ti-plus"></i> Nuevo período anual
        </button>}
        {!esSocio && selectedPeriodo && (
          <button className="btn" style={{ color: '#5dcaa5', borderColor: 'rgba(29,158,117,0.4)', marginLeft: 'auto' }}
            onClick={handleExportar} disabled={exportando}>
            {exportando ? <><i className="ti ti-loader"></i> Exportando…</> : <><i className="ti ti-file-spreadsheet"></i> Exportar Excel</>}
          </button>
        )}
      </div>

      {/* Stats */}
      {selectedPeriodo && (!esSocio || miSocioId) && (() => {
        const miPagado = esSocio && socios[0] ? (pagosPorSocio[socios[0].id]?.total || 0) : 0
        const miPendiente = esSocio ? Math.max(0, montoAnual - miPagado) : 0
        const stats = esSocio
          ? [
              { label: `Cuota ${selectedPeriodo.anio}`, value: `$${montoAnual.toLocaleString('es-CL')}`, color: 'var(--gold-light)' },
              { label: 'Pagado', value: `$${miPagado.toLocaleString('es-CL')}`, color: '#5dcaa5' },
              { label: 'Pendiente', value: miPendiente > 0 ? `$${miPendiente.toLocaleString('es-CL')}` : 'Al día', color: miPendiente > 0 ? '#fac775' : 'var(--text-muted)' },
            ]
          : [
              { label: 'Año', value: selectedPeriodo.anio, color: 'var(--gold-light)' },
              { label: 'Cuota anual', value: `$${montoAnual.toLocaleString('es-CL')}`, color: 'var(--gold-light)' },
              { label: 'Total recaudado', value: `$${totalRecaudado.toLocaleString('es-CL')}`, color: '#5dcaa5' },
              { label: 'Socios con pago', value: `${sociosConPago} / ${socios.length}`, color: '#fac775' },
            ]
        return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stats.length},1fr)`, gap: 12, marginBottom: '1.5rem' }}>
            {stats.map(s => (
              <div key={s.label} style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Buscador */}
          {!esSocio && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="search-box" style={{ width: 280 }}>
                <i className="ti ti-search"></i>
                <input placeholder="Buscar socio…" value={filtroSocio} onChange={e => setFiltroSocio(e.target.value)} />
              </div>
            </div>
          )}

          {/* Tabla por socio */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><i className="ti ti-receipt"></i> {esSocio ? `Mi estado de cuotas — ${selectedPeriodo.anio}` : `Pagos por socio — ${selectedPeriodo.anio}`}</div>
            </div>
            {loading ? (
              <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
            ) : (
              <table>
                <thead>
                  <tr><th>Socio</th><th>Estado socio</th><th>Pagado</th><th>Pendiente</th>{!esSocio && <th>Deuda anterior</th>}<th>Estado</th><th>Última fecha</th>{editable && <th>Acciones</th>}</tr>
                </thead>
                <tbody>
                  {sociosFiltrados.map(s => {
                    const sp = pagosPorSocio[s.id]
                    const total = sp?.total || 0
                    const pendiente = Math.max(0, montoAnual - total)
                    const pct = montoAnual > 0 ? Math.round((total / montoAnual) * 100) : 0
                    const ultimoPago = sp?.pagos?.[sp.pagos.length - 1]
                    return (
                      <React.Fragment key={s.id}>
                      <tr>
                        <td>
                          <div className="name-cell">
                            <div className="avatar" style={{ background: s.estado === 'inactivo' ? 'rgba(163,45,45,0.25)' : 'rgba(83,74,183,0.3)', color: s.estado === 'inactivo' ? '#f09595' : '#afa9ec' }}>{s.nombre[0]}{s.apellido[0]}</div>
                            <div>
                              <div>{s.nombre} {s.apellido}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{s.numero_socio}
                                {s.estado === 'inactivo' && s.fecha_inactividad && (
                                  <span style={{ marginLeft: 6, color: '#f09595' }}>· Inactivo desde {s.fecha_inactividad.split('-').reverse().join('/')}</span>
                                )}
                                {s.estado === 'inactivo' && !s.fecha_inactividad && (
                                  <span style={{ marginLeft: 6, color: '#f09595' }}>· Inactivo</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {s.estado === 'activo' && <span className="badge badge-active">Activo</span>}
                            {s.estado === 'inactivo' && <span className="badge badge-inactive">Inactivo</span>}
                            {s.estado === 'pendiente' && <span className="badge badge-pending">Pendiente</span>}
                            {editable && !esSocio && (
                              <select
                                value={s.estado || 'activo'}
                                onChange={e => handleCambiarEstadoSocio(s, e.target.value)}
                                onClick={e => e.stopPropagation()}
                                title="Cambiar estado del socio"
                                style={{ fontSize: 11, padding: '2px 6px', width: 'auto', background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer' }}
                              >
                                <option value="activo">Activo</option>
                                <option value="pendiente">Pendiente</option>
                                <option value="inactivo">Inactivo</option>
                              </select>
                            )}
                          </div>
                        </td>
                        <td>
                          <div style={{ color: '#5dcaa5', fontWeight: 'bold' }}>${total.toLocaleString('es-CL')}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                            <div style={{ width: 80, height: 3, background: 'rgba(201,168,76,0.15)', borderRadius: 2, marginTop: 4 }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#5dcaa5' : 'var(--gold)', borderRadius: 2 }}></div>
                            </div>
                          </div>
                        </td>
                        <td style={{ color: pendiente > 0 ? '#fac775' : 'var(--text-dim)' }}>
                          {pendiente > 0 ? `$${pendiente.toLocaleString('es-CL')}` : '—'}
                        </td>
                        {!esSocio && (() => {
                          const d = deudaHistoricaSocio(s.id)
                          if (d.monto === 0) return <td style={{ color: 'var(--text-dim)' }}>—</td>
                          const tooltip = d.detalle.map(r => `${r.anio}: $${r.pendiente.toLocaleString('es-CL')}`).join(' · ')
                          return (
                            <td>
                              <span className="chip" title={tooltip}
                                style={{ background: 'rgba(240,149,149,0.15)', color: '#f09595', border: '0.5px solid rgba(240,149,149,0.3)', fontWeight: 'bold' }}>
                                ${d.monto.toLocaleString('es-CL')}
                              </span>
                            </td>
                          )
                        })()}
                        <td>
                          {total === 0 && <span className="badge badge-pending">Sin pago</span>}
                          {total > 0 && total < montoAnual && <span className="badge badge-pending">Parcial ({pct}%)</span>}
                          {total >= montoAnual && montoAnual > 0 && <span className="badge badge-active">Al día</span>}
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                          {ultimoPago ? new Date(ultimoPago.fecha_pago).toLocaleDateString('es-CL') : '—'}
                        </td>
                        {editable && (
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-primary" onClick={() => openRegistrarPago(s)}>
                              <i className="ti ti-plus"></i> Registrar pago
                            </button>
                            {sp?.pagos?.length > 0 && (
                              <button className="btn btn-sm"
                                style={detalleSocioId === s.id ? { color: 'var(--gold)', borderColor: 'var(--border-strong)' } : {}}
                                onClick={() => setDetalleSocioId(detalleSocioId === s.id ? null : s.id)}>
                                <i className={`ti ${detalleSocioId === s.id ? 'ti-chevron-up' : 'ti-receipt'}`}></i>
                                {sp.pagos.length} {sp.pagos.length === 1 ? 'pago' : 'pagos'}
                              </button>
                            )}
                          </div>
                        </td>
                        )}
                      </tr>

                      {/* Panel detalle pagos */}
                      {detalleSocioId === s.id && sp?.pagos?.length > 0 && (
                        <tr key={`det-${s.id}`}>
                          <td colSpan={6} style={{ padding: 0, background: 'rgba(10,22,40,0.4)' }}>
                            <div style={{ padding: '0.75rem 1.5rem' }}>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontFamily: 'sans-serif' }}>
                                Detalle de pagos — {s.nombre} {s.apellido}
                              </div>
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                  <tr>
                                    <th style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-dim)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: 1 }}>Fecha</th>
                                    <th style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-dim)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: 1 }}>Concepto</th>
                                    <th style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-dim)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: 1 }}>Monto</th>
                                    <th style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-dim)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: 1 }}>Forma pago</th>
                                    <th style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-dim)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: 1 }}>Cheque</th>
                                    <th style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-dim)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: 1 }}>Comentario</th>
                                    <th style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-dim)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: 1 }}>Acciones</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sp.pagos.map(p => (
                                    <tr key={p.id}>
                                      {editPago?.id === p.id ? (
                                        <>
                                          <td style={{ padding: '6px 10px' }}>
                                            <input type="date" value={editPago.fecha_pago}
                                              onChange={e => setEditPago(ep => ({ ...ep, fecha_pago: e.target.value }))}
                                              style={{ fontSize: 12, padding: '3px 6px', width: 130 }} />
                                          </td>
                                          <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-dim)' }}>
                                            {p.concepto || 'Cuota social'}
                                          </td>
                                          <td style={{ padding: '6px 10px' }}>
                                            <input type="text" inputMode="numeric"
                                              value={editPago.monto}
                                              onChange={e => setEditPago(ep => ({ ...ep, monto: e.target.value }))}
                                              onBlur={() => { const n = parsearMonto(editPago.monto); if (n > 0) setEditPago(ep => ({ ...ep, monto: formatearMonto(n) })) }}
                                              style={{ fontSize: 12, padding: '3px 6px', width: 100 }} />
                                          </td>
                                          <td style={{ padding: '6px 10px' }}>
                                            <select value={editPago.forma_pago}
                                              onChange={e => setEditPago(ep => ({ ...ep, forma_pago: e.target.value }))}
                                              style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }}>
                                              {FORMAS_PAGO.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                            </select>
                                          </td>
                                          <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-dim)' }}>
                                            {p.cheques ? `N°${p.cheques.numero}` : '—'}
                                          </td>
                                          <td style={{ padding: '6px 10px' }}>
                                            <input type="text" value={editPago.comentario || ''}
                                              onChange={e => setEditPago(ep => ({ ...ep, comentario: e.target.value }))}
                                              placeholder="Comentario…"
                                              style={{ fontSize: 12, padding: '3px 6px', width: 160 }} />
                                          </td>
                                          <td style={{ padding: '6px 10px' }}>
                                            <div style={{ display: 'flex', gap: 4 }}>
                                              <button className="btn btn-sm btn-primary" onClick={handleGuardarEditPago} disabled={saving}>
                                                <i className="ti ti-check"></i> Guardar
                                              </button>
                                              <button className="btn btn-sm" onClick={() => setEditPago(null)}>
                                                <i className="ti ti-x"></i>
                                              </button>
                                            </div>
                                          </td>
                                        </>
                                      ) : (
                                        <>
                                          <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                                            {p.fecha_pago.split('-').reverse().join('/')}
                                          </td>
                                          <td style={{ padding: '6px 10px' }}>
                                            {(() => {
                                              const concepto = p.concepto || 'Cuota social'
                                              const lc = concepto.toLowerCase()
                                              const isIncorp = lc.includes('incorpora')
                                              const isCuota = lc.includes('cuota')
                                              const style = isIncorp
                                                ? { background: 'rgba(239,159,39,0.15)', color: '#fac775' }
                                                : isCuota
                                                  ? { background: 'rgba(55,138,221,0.15)', color: '#85b7eb' }
                                                  : { background: 'rgba(175,169,236,0.15)', color: '#afa9ec' }
                                              return (
                                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                  <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 500, ...style }}>
                                                    {concepto}
                                                  </span>
                                                  {p.movimiento_id && (
                                                    <span
                                                      title={p.movimientos?.descripcion || p.comentario || 'Conciliado con la cartola bancaria'}
                                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 500, background: 'rgba(29,158,117,0.15)', color: '#5dcaa5', cursor: 'help' }}>
                                                      <i className="ti ti-building-bank" style={{ fontSize: 11 }}></i> En cartola bancaria
                                                    </span>
                                                  )}
                                                </div>
                                              )
                                            })()}
                                          </td>
                                          <td style={{ padding: '6px 10px', fontSize: 13, color: '#5dcaa5', fontWeight: 'bold' }}>
                                            {formatearMontoConSimbolo(p.monto)}
                                          </td>
                                          <td style={{ padding: '6px 10px' }}>
                                            <span className="chip">{FORMAS_PAGO.find(f => f.value === p.forma_pago)?.label || p.forma_pago}</span>
                                          </td>
                                          <td style={{ padding: '6px 10px', fontSize: 12 }}>
                                            {p.cheques ? (
                                              <div>
                                                <div style={{ color: 'var(--gold)', fontWeight: 'bold' }}>N°{p.cheques.numero}</div>
                                                <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                                                  {(() => {
                                                    const f = p.cheques.fecha_deposito || p.cheques.fecha_documento
                                                    if (!f) return 'Depósito: Sin fecha'
                                                    const txt = f.split('-').reverse().join('/')
                                                    return p.cheques.fecha_deposito ? `Depósito: ${txt}` : `A fecha: ${txt}`
                                                  })()}
                                                </div>
                                                <span className={`badge ${p.cheques.estado === 'depositado' ? 'badge-active' : 'badge-pending'}`} style={{ fontSize: 10 }}>
                                                  {p.cheques.estado === 'depositado' ? 'Depositado' : 'Por depositar'}
                                                </span>
                                              </div>
                                            ) : '—'}
                                          </td>
                                          <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                                            {p.comentario && !p.comentario.startsWith('Conciliado desde cartola') ? p.comentario : '—'}
                                          </td>
                                          <td style={{ padding: '6px 10px' }}>
                                            {editable && (
                                              <div style={{ display: 'flex', gap: 4 }}>
                                                <button className="btn btn-sm" title="Editar" onClick={() => setEditPago({
                                                  id: p.id,
                                                  monto: formatearMonto(p.monto),
                                                  fecha_pago: p.fecha_pago,
                                                  forma_pago: p.forma_pago,
                                                  comentario: p.comentario || '',
                                                })}>
                                                  <i className="ti ti-edit"></i>
                                                </button>
                                                <button className="btn btn-sm btn-danger" title="Eliminar" onClick={() => handleEliminarPago(p.id)}>
                                                  <i className="ti ti-trash"></i>
                                                </button>
                                              </div>
                                            )}
                                          </td>
                                        </>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
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

          {/* Historial de pagos del período */}
          {(() => {
            const pagosVisibles = esSocio && miSocioId ? pagos.filter(p => p.socio_id === miSocioId) : pagos
            if (pagosVisibles.length === 0) return null
            return (
            <div className="card">
              <div className="card-header">
                <div className="card-title"><i className="ti ti-clock"></i> {esSocio ? 'Mi historial de pagos' : 'Historial de pagos'} — {selectedPeriodo.anio}</div>
              </div>
              <table>
                <thead><tr>{!esSocio && <th>Socio</th>}<th>Fecha</th><th>Monto</th><th>Forma pago</th><th>Comentario</th><th></th></tr></thead>
                <tbody>
                  {pagosVisibles.map(p => (
                    <tr key={p.id}>
                      {!esSocio && (
                        <td>
                          <div className="name-cell">
                            <div className="avatar" style={{ background: 'rgba(83,74,183,0.3)', color: '#afa9ec' }}>{p.socios?.nombre[0]}{p.socios?.apellido[0]}</div>
                            <div>{p.socios?.nombre} {p.socios?.apellido}<div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{p.socios?.numero_socio}</div></div>
                          </div>
                        </td>
                      )}
                      <td style={{ color: 'var(--text-muted)' }}>{new Date(p.fecha_pago).toLocaleDateString('es-CL')}</td>
                      <td style={{ color: '#5dcaa5', fontWeight: 'bold' }}>${p.monto.toLocaleString('es-CL')}</td>
                      <td>
                        <span className="chip">{FORMAS_PAGO.find(f => f.value === p.forma_pago)?.label || p.forma_pago}</span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.comentario || '—'}</td>
                      <td>
                        {editable && <button className="btn btn-sm btn-danger" onClick={() => handleEliminarPago(p.id)}><i className="ti ti-trash"></i></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )
          })()}

          {/* Cheques entregados por el socio */}
          {esSocio && misCheques.length > 0 && (
            <div className="card" style={{ marginTop: '1rem' }}>
              <div className="card-header">
                <div className="card-title"><i className="ti ti-writing"></i> Mis cheques entregados</div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                  {misCheques.length} cheque(s) · {misCheques.filter(c => c.estado === 'por_depositar').length} por depositar
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, padding: '1rem 1.25rem', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ background: 'var(--navy-mid)', borderRadius: 8, padding: '0.75rem 1rem' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Total cheques</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold' }}>{misCheques.length}</div>
                </div>
                <div style={{ background: 'var(--navy-mid)', borderRadius: 8, padding: '0.75rem 1rem' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Depositados</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#5dcaa5' }}>
                    {misCheques.filter(c => c.estado === 'depositado').length}
                  </div>
                </div>
                <div style={{ background: 'var(--navy-mid)', borderRadius: 8, padding: '0.75rem 1rem' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Por depositar</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#fac775' }}>
                    {misCheques.filter(c => c.estado === 'por_depositar').length}
                  </div>
                </div>
              </div>

              {['cuota_social', 'incorporacion'].map(concepto => {
                const chequesConcepto = misCheques.filter(c => c.concepto === concepto)
                if (chequesConcepto.length === 0) return null
                const totalConcepto = chequesConcepto.reduce((t, c) => t + c.monto, 0)
                const totalDepositado = chequesConcepto.filter(c => c.estado === 'depositado').reduce((t, c) => t + c.monto, 0)
                return (
                  <div key={concepto}>
                    <div style={{ padding: '0.75rem 1.25rem', borderBottom: '0.5px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>
                        {concepto === 'cuota_social' ? 'Cuota social' : 'Incorporación'}
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8, fontFamily: 'sans-serif' }}>
                          {chequesConcepto.length} cheque(s) · {formatearMontoConSimbolo(totalConcepto)}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#5dcaa5', fontFamily: 'sans-serif' }}>
                        Cobrado: {formatearMontoConSimbolo(totalDepositado)} de {formatearMontoConSimbolo(totalConcepto)}
                      </div>
                    </div>
                    <table>
                      <thead>
                        <tr><th>N° Cheque</th><th>Monto</th><th>F. depósito</th><th>Banco</th><th>Estado</th></tr>
                      </thead>
                      <tbody>
                        {chequesConcepto.map(c => (
                          <tr key={c.id}>
                            <td><span className="chip">{c.numero}</span></td>
                            <td style={{ color: '#5dcaa5', fontWeight: 'bold' }}>{formatearMontoConSimbolo(c.monto)}</td>
                            <td style={{ color: 'var(--text-muted)' }}>
                              {(() => {
                                const f = c.fecha_deposito || c.fecha_documento
                                if (!f) return '—'
                                const txt = f.split('-').reverse().join('/')
                                return c.fecha_deposito ? txt : `${txt} *`
                              })()}
                            </td>
                            <td style={{ color: 'var(--text-muted)' }}>{c.banco_destino || c.banco_emisor || '—'}</td>
                            <td>
                              {c.estado === 'depositado' && <span className="badge badge-active">Depositado</span>}
                              {c.estado === 'por_depositar' && <span className="badge badge-pending">Por depositar</span>}
                              {c.estado === 'anulado' && <span className="badge badge-inactive">Anulado</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>
          )}
        </>
        )
      })()}

      {periodos.length === 0 && (
        <div className="empty-state" style={{ marginTop: '2rem' }}>
          <i className="ti ti-receipt-off"></i>
          No hay períodos creados. Crea el primero haciendo clic en "Nuevo período anual".
        </div>
      )}

      {/* Modal nuevo período */}
      {showModalPeriodo && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModalPeriodo(false)}>
          <div className="modal" style={{ width: 420 }}>
            <div className="modal-header">
              <div className="modal-title">Nuevo período anual</div>
              <button className="btn btn-sm" onClick={() => setShowModalPeriodo(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label>Año *</label>
                <input type="number" value={formPeriodo.anio} onChange={e => setFormPeriodo(f => ({ ...f, anio: e.target.value }))} placeholder="2026" />
              </div>
              <div className="form-group">
                <label>Monto cuota anual ($) *</label>
                <input type="number" value={formPeriodo.monto} onChange={e => setFormPeriodo(f => ({ ...f, monto: e.target.value }))} placeholder="500000" />
              </div>
              <div className="form-group full">
                <label>Descripción</label>
                <input value={formPeriodo.descripcion} onChange={e => setFormPeriodo(f => ({ ...f, descripcion: e.target.value }))} placeholder="Cuota anual ordinaria 2026" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModalPeriodo(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCrearPeriodo} disabled={saving}>
                {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Crear período</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal registrar pago */}
      {showModalPago && selectedSocio && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModalPago(false)}>
          <div className="modal" style={{ width: 480 }}>
            <div className="modal-header">
              <div className="modal-title">Registrar pago — {selectedSocio.nombre} {selectedSocio.apellido}</div>
              <button className="btn btn-sm" onClick={() => setShowModalPago(false)}><i className="ti ti-x"></i></button>
            </div>
            <div style={{ padding: '0.75rem 1.5rem', background: 'rgba(201,168,76,0.06)', borderBottom: '0.5px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
              Período {selectedPeriodo.anio} · Cuota anual: ${montoAnual.toLocaleString('es-CL')} ·
              Pagado: ${(pagosPorSocio[selectedSocio.id]?.total || 0).toLocaleString('es-CL')} ·
              Pendiente: ${Math.max(0, montoAnual - (pagosPorSocio[selectedSocio.id]?.total || 0)).toLocaleString('es-CL')}
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label>Monto del pago ($) *</label>
                <input type="number" {...FP('monto')} placeholder="500000" />
              </div>
              <div className="form-group">
                <label>Fecha de pago *</label>
                <input type="date" {...FP('fecha_pago')} />
              </div>
              <div className="form-group">
                <label>Forma de pago</label>
                <select {...FP('forma_pago')}>
                  {FORMAS_PAGO.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              {formPago.forma_pago === 'cheque' && (
                <div className="form-group">
                  <label>Cheque asociado</label>
                  <select {...FP('cheque_id')}>
                    <option value="">Sin asociar</option>
                    {cheques
                      .filter(c => !pagos.some(p => p.cheque_id === c.id))
                      .map(c => (
                        <option key={c.id} value={c.id}>
                          N°{c.numero} — {formatearMontoConSimbolo(c.monto)}{(c.fecha_deposito || c.fecha_documento) ? ` · ${c.fecha_deposito ? 'Depósito' : 'A fecha'}: ${(c.fecha_deposito || c.fecha_documento).split('-').reverse().join('/')}` : ''}
                        </option>
                      ))
                    }
                  </select>
                  {cheques.filter(c => pagos.some(p => p.cheque_id === c.id)).length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                      {cheques.filter(c => pagos.some(p => p.cheque_id === c.id)).length} cheque(s) ya utilizados en otros pagos no se muestran
                    </div>
                  )}
                </div>
              )}
              <div className="form-group full">
                <label>Comentario</label>
                <input placeholder="Ej: Pago parcial 1 de 3" {...FP('comentario')} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModalPago(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleRegistrarPago} disabled={saving}>
                {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Registrar pago</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
