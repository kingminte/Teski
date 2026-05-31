import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { formatearMontoConSimbolo } from '../lib/montos'

const NOMBRES_MES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const generarMeses = () => {
  const meses = []
  const hoy = new Date()
  for (let a = 2022; a <= hoy.getFullYear(); a++) {
    for (let m = 1; m <= 12; m++) {
      if (a === hoy.getFullYear() && m > hoy.getMonth() + 1) break
      meses.push({ value: `${a}-${String(m).padStart(2, '0')}`, label: `${NOMBRES_MES[m]} ${a}` })
    }
  }
  return meses
}

const mesAnterior = (mesStr) => {
  const [a, m] = mesStr.split('-').map(Number)
  if (m === 1) return { anio: a - 1, mes: 12 }
  return { anio: a, mes: m - 1 }
}

export default function ReporteFinanciero() {
  const { showToast, ToastComponent } = useToast()
  const hoy = new Date()
  const anioActual = hoy.getFullYear()
  const mesActual = hoy.getMonth() + 1
  const defaultDesde = `${anioActual - 1}-${String(mesActual).padStart(2, '0')}`
  const defaultHasta = `${anioActual}-${String(Math.max(1, mesActual - 1)).padStart(2, '0')}`

  const [fechaDesde, setFechaDesde] = useState(defaultDesde)
  const [fechaHasta, setFechaHasta] = useState(defaultHasta)
  const [datos, setDatos] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expandido, setExpandido] = useState(null)
  const [exportando, setExportando] = useState(false)

  const meses = generarMeses()

  useEffect(() => { generarReporte() }, [])

  const generarReporte = async () => {
    if (fechaDesde > fechaHasta) { showToast('La fecha desde no puede ser mayor a la hasta', 'error'); return }
    setLoading(true)
    setExpandido(null)
    try {
      const [aD, mD] = fechaDesde.split('-').map(Number)
      const [aH, mH] = fechaHasta.split('-').map(Number)
      const fechaInicio = `${fechaDesde}-01`
      const ultimoDia = new Date(aH, mH, 0).getDate()
      const fechaFin = `${fechaHasta}-${String(ultimoDia).padStart(2, '0')}`

      const [pagosRes, otrosIngRes, movRes, pagosCPRes] = await Promise.all([
        supabase.from('pagos_cuota')
          .select('*, socios(nombre,apellido,numero_socio), periodos_cuota(anio)')
          .gte('fecha_pago', fechaInicio).lte('fecha_pago', fechaFin)
          .order('fecha_pago'),
        supabase.from('otros_ingresos').select('*').gte('fecha', fechaInicio).lte('fecha', fechaFin).order('fecha'),
        supabase.from('movimientos')
          .select('*, chequera_detalle(id, beneficiario, concepto, folio), cartolas(nombre_archivo)')
          .gte('fecha', fechaInicio).lte('fecha', fechaFin).lt('monto', 0).order('fecha'),
        supabase.from('pagos_cuenta')
          .select('*, cuentas_por_pagar(concepto, categoria, proveedores(nombre))')
          .gte('fecha_pago', fechaInicio).lte('fecha_pago', fechaFin)
          .eq('estado', 'pagado').order('fecha_pago'),
      ])
      const pagos = pagosRes.data || []
      const otrosIng = otrosIngRes.data || []
      const movimientos = movRes.data || []
      const pagosCP = pagosCPRes.data || []

      // Saldo anterior: cartola del mes anterior a fechaDesde
      const ant = mesAnterior(fechaDesde)
      const { data: cartolaAnt } = await supabase.from('cartolas')
        .select('saldo_final').eq('mes', ant.mes).eq('anio', ant.anio).limit(1).maybeSingle()
      let saldoAnterior = cartolaAnt?.saldo_final ?? null
      let saldoAnteriorCalculado = false
      if (saldoAnterior === null) {
        saldoAnterior = 0
        saldoAnteriorCalculado = true
      }

      // Saldo final: cartola del mes de fechaHasta
      const { data: cartolaFin } = await supabase.from('cartolas')
        .select('saldo_final').eq('mes', mH).eq('anio', aH).limit(1).maybeSingle()
      let saldoCtaCte = cartolaFin?.saldo_final ?? null
      let saldoCtaCteCalculado = false

      // Ingresos
      const cuotasSociales = pagos.filter(p => !p.concepto || p.concepto.toLowerCase().includes('cuota'))
      const inscripciones = pagos.filter(p => p.concepto && p.concepto.toLowerCase().includes('incorpora'))
      const otrosPagos = pagos.filter(p => p.concepto && !p.concepto.toLowerCase().includes('cuota') && !p.concepto.toLowerCase().includes('incorpora'))

      const otrosIngAgrupados = {}
      const addOtro = (key, item, monto) => {
        if (!otrosIngAgrupados[key]) otrosIngAgrupados[key] = { concepto: key, items: [], total: 0 }
        otrosIngAgrupados[key].items.push(item)
        otrosIngAgrupados[key].total += monto
      }
      otrosIng.forEach(o => addOtro(o.concepto || 'Otros ingresos',
        { fecha: o.fecha, descripcion: o.descripcion || '', concepto: o.concepto, monto: o.monto }, o.monto))
      otrosPagos.forEach(p => addOtro(p.concepto || 'Otros ingresos',
        { fecha: p.fecha_pago, descripcion: p.socios ? `${p.socios.nombre} ${p.socios.apellido} (${p.socios.numero_socio})` : 'Socio', concepto: p.concepto, monto: p.monto }, p.monto))

      const totalCuotas = cuotasSociales.reduce((t, p) => t + p.monto, 0)
      const totalInscripciones = inscripciones.reduce((t, p) => t + p.monto, 0)
      const totalOtrosIng = Object.values(otrosIngAgrupados).reduce((t, g) => t + g.total, 0)
      const totalPeriodoIng = totalCuotas + totalInscripciones + totalOtrosIng

      // Egresos
      const egresosAgrupados = {}
      const addEgreso = (cat, item, monto) => {
        if (!egresosAgrupados[cat]) egresosAgrupados[cat] = { concepto: cat, items: [], total: 0 }
        egresosAgrupados[cat].items.push(item)
        egresosAgrupados[cat].total += monto
      }
      movimientos.forEach(m => {
        const cat = m.chequera_detalle?.concepto || 'Otros gastos'
        const monto = Math.abs(m.monto)
        addEgreso(cat, {
          fecha: m.fecha,
          proveedor: m.chequera_detalle?.beneficiario || '',
          descripcion: m.descripcion || '',
          monto,
          cheque: m.chequera_detalle?.folio ? `N°${m.chequera_detalle.folio}` : '',
        }, monto)
      })
      pagosCP.forEach(p => {
        if (p.chequera_detalle_id) return // ya contado vía movimiento
        const cat = p.cuentas_por_pagar?.categoria || p.cuentas_por_pagar?.concepto || 'Otros gastos'
        addEgreso(cat, {
          fecha: p.fecha_pago,
          proveedor: p.cuentas_por_pagar?.proveedores?.nombre || '',
          descripcion: p.cuentas_por_pagar?.concepto || '',
          monto: p.monto,
          cheque: '',
        }, p.monto)
      })

      const totalEgresos = Object.values(egresosAgrupados).reduce((t, g) => t + g.total, 0)

      // Si no hay cartola del mes final, calcular saldo por diferencia
      if (saldoCtaCte === null) {
        saldoCtaCte = saldoAnterior + totalPeriodoIng - totalEgresos
        saldoCtaCteCalculado = true
      }

      setDatos({
        rango: { fechaDesde, fechaHasta, fechaInicio, fechaFin, aD, mD, aH, mH, ultimoDia },
        cuotasSociales, inscripciones, otrosIngAgrupados,
        totalCuotas, totalInscripciones, totalOtrosIng, totalPeriodoIng,
        egresosAgrupados, totalEgresos,
        saldoAnterior, saldoCtaCte,
        saldoAnteriorCalculado, saldoCtaCteCalculado,
        totalIngresos: totalPeriodoIng + saldoAnterior,
        totalEgresosMasSaldo: totalEgresos + saldoCtaCte,
      })
    } catch (e) {
      showToast('Error: ' + e.message, 'error')
    }
    setLoading(false)
  }

  const handleExportar = async () => {
    if (!datos) return
    setExportando(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()

      const ingresosRows = []
      datos.cuotasSociales.forEach(p => ingresosRows.push([
        p.fecha_pago ? p.fecha_pago.split('-').reverse().join('/') : '',
        p.socios ? `${p.socios.nombre} ${p.socios.apellido}` : '',
        p.socios?.numero_socio || '',
        p.concepto || 'Cuota social',
        p.monto,
        'Cuotas sociales',
      ]))
      datos.inscripciones.forEach(p => ingresosRows.push([
        p.fecha_pago ? p.fecha_pago.split('-').reverse().join('/') : '',
        p.socios ? `${p.socios.nombre} ${p.socios.apellido}` : '',
        p.socios?.numero_socio || '',
        p.concepto || 'Incorporación',
        p.monto,
        'Inscripciones',
      ]))
      Object.values(datos.otrosIngAgrupados).forEach(g => {
        g.items.forEach(it => ingresosRows.push([
          it.fecha ? it.fecha.split('-').reverse().join('/') : '',
          it.descripcion || '',
          '',
          it.concepto || g.concepto,
          it.monto,
          g.concepto,
        ]))
      })
      const wsIng = XLSX.utils.aoa_to_sheet([
        ['Fecha', 'Socio/Descripción', 'N° Socio', 'Concepto', 'Monto', 'Categoría'],
        ...ingresosRows,
        ['', '', '', 'TOTAL PERÍODO', datos.totalPeriodoIng, ''],
        ['', '', '', 'Saldo anterior', datos.saldoAnterior, ''],
        ['', '', '', 'TOTAL INGRESOS', datos.totalIngresos, ''],
      ])
      wsIng['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 10 }, { wch: 24 }, { wch: 14 }, { wch: 24 }]
      XLSX.utils.book_append_sheet(wb, wsIng, 'Ingresos')

      const egresosRows = []
      Object.values(datos.egresosAgrupados).forEach(g => {
        g.items.forEach(it => egresosRows.push([
          it.fecha ? it.fecha.split('-').reverse().join('/') : '',
          it.proveedor || '',
          it.descripcion || '',
          it.cheque || '',
          it.monto,
          g.concepto,
        ]))
      })
      const wsEg = XLSX.utils.aoa_to_sheet([
        ['Fecha', 'Proveedor', 'Detalle', 'Cheque', 'Monto', 'Categoría'],
        ...egresosRows,
        ['', '', '', '', datos.totalEgresos, 'TOTAL EGRESOS'],
        ['', '', '', '', datos.saldoCtaCte, 'Saldo cta cte'],
        ['', '', '', '', datos.totalEgresosMasSaldo, 'TOTAL'],
      ])
      wsEg['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 30 }, { wch: 10 }, { wch: 14 }, { wch: 24 }]
      XLSX.utils.book_append_sheet(wb, wsEg, 'Egresos')

      const desdeLabel = NOMBRES_MES[datos.rango.mD] + datos.rango.aD
      const hastaLabel = NOMBRES_MES[datos.rango.mH] + datos.rango.aH
      XLSX.writeFile(wb, `Reporte_financiero_${desdeLabel}_${hastaLabel}.xlsx`)
      showToast('Excel exportado')
    } catch (e) {
      showToast('Error al exportar: ' + e.message, 'error')
    }
    setExportando(false)
  }

  const toggle = (id) => setExpandido(expandido === id ? null : id)

  const renderFila = (id, label, monto, items = null, color = 'inherit') => {
    const tieneDetalle = items && items.length > 0
    const open = expandido === id
    return (
      <div>
        <div onClick={tieneDetalle ? () => toggle(id) : undefined}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.6rem 1rem', borderBottom: '0.5px solid var(--border)',
            cursor: tieneDetalle ? 'pointer' : 'default',
            fontSize: 13, fontFamily: 'sans-serif',
          }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {tieneDetalle && <i className={`ti ti-chevron-${open ? 'down' : 'right'}`} style={{ fontSize: 12, color: 'var(--text-dim)' }}></i>}
            {label}
          </span>
          <strong style={{ color }}>{formatearMontoConSimbolo(monto)}</strong>
        </div>
        {open && tieneDetalle && (
          <div style={{ background: 'var(--navy-mid)', padding: '0.5rem 0', borderBottom: '0.5px solid var(--border)' }}>
            <table style={{ width: '100%', fontSize: 11, fontFamily: 'sans-serif' }}>
              <thead>
                <tr style={{ color: 'var(--text-dim)' }}>
                  <th style={{ padding: '4px 12px', textAlign: 'left', textTransform: 'uppercase', letterSpacing: 1 }}>Fecha</th>
                  <th style={{ padding: '4px 12px', textAlign: 'left', textTransform: 'uppercase', letterSpacing: 1 }}>Detalle</th>
                  <th style={{ padding: '4px 12px', textAlign: 'right', textTransform: 'uppercase', letterSpacing: 1 }}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td style={{ padding: '3px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{it.fecha ? it.fecha.split('-').reverse().join('/') : '—'}</td>
                    <td style={{ padding: '3px 12px' }}>
                      {it.proveedor && <span style={{ color: '#c8d0dc' }}>{it.proveedor}</span>}
                      {it.proveedor && it.descripcion && <span style={{ color: 'var(--text-dim)' }}> · </span>}
                      {it.descripcion && <span style={{ color: 'var(--text-muted)' }}>{it.descripcion}</span>}
                      {it.cheque && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--gold-dim)' }}>{it.cheque}</span>}
                    </td>
                    <td style={{ padding: '3px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#c8d0dc' }}>{formatearMontoConSimbolo(it.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  const cuadra = datos && datos.totalIngresos === datos.totalEgresosMasSaldo
  const diferencia = datos ? datos.totalIngresos - datos.totalEgresosMasSaldo : 0

  return (
    <div>
      {ToastComponent}

      {/* Controles */}
      <div className="card no-print">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-report-money"></i> Reporte financiero</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" style={{ color: '#5dcaa5', borderColor: 'rgba(29,158,117,0.4)' }} onClick={handleExportar} disabled={!datos || exportando}>
              {exportando ? <><i className="ti ti-loader"></i> Exportando…</> : <><i className="ti ti-file-spreadsheet"></i> Excel</>}
            </button>
            <button className="btn btn-sm" onClick={() => window.print()} disabled={!datos}>
              <i className="ti ti-printer"></i> Imprimir
            </button>
          </div>
        </div>
        <div style={{ padding: '1rem 1.25rem', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', display: 'block', marginBottom: 4 }}>Desde</label>
            <select value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} style={{ width: 'auto', fontSize: 13 }}>
              {meses.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', display: 'block', marginBottom: 4 }}>Hasta</label>
            <select value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} style={{ width: 'auto', fontSize: 13 }}>
              {meses.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={generarReporte} disabled={loading} style={{ marginTop: 18 }}>
            {loading ? <><i className="ti ti-loader"></i> Generando…</> : <><i className="ti ti-refresh"></i> Generar reporte</>}
          </button>
        </div>
      </div>

      {datos && (
        <>
          {/* Título */}
          <div style={{ textAlign: 'center', margin: '1.5rem 0' }}>
            <div style={{ fontSize: 18, color: 'var(--gold-light)', fontWeight: 'bold', letterSpacing: 0.5 }}>
              Movimiento financiero de Teski Club
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginTop: 4 }}>
              01 de {NOMBRES_MES[datos.rango.mD]} de {datos.rango.aD} – {datos.rango.ultimoDia} de {NOMBRES_MES[datos.rango.mH]} de {datos.rango.aH}
            </div>
          </div>

          {/* Dos columnas */}
          <div className="reporte-cols">
            {/* INGRESOS */}
            <div className="card">
              <div className="card-header" style={{ background: 'rgba(29,158,117,0.08)' }}>
                <div className="card-title" style={{ color: '#5dcaa5' }}>
                  <i className="ti ti-trending-up"></i> Ingresos
                </div>
              </div>
              {renderFila('ing-cuotas', 'Cuotas sociales', datos.totalCuotas,
                datos.cuotasSociales.map(p => ({
                  fecha: p.fecha_pago,
                  proveedor: p.socios ? `${p.socios.nombre} ${p.socios.apellido}` : 'Socio',
                  descripcion: p.socios?.numero_socio || '',
                  monto: p.monto,
                })), '#5dcaa5')}
              {renderFila('ing-insc', 'Inscripciones', datos.totalInscripciones,
                datos.inscripciones.map(p => ({
                  fecha: p.fecha_pago,
                  proveedor: p.socios ? `${p.socios.nombre} ${p.socios.apellido}` : 'Socio',
                  descripcion: p.socios?.numero_socio || '',
                  monto: p.monto,
                })), '#5dcaa5')}
              {Object.values(datos.otrosIngAgrupados).map(g =>
                <div key={g.concepto}>{renderFila(`ing-${g.concepto}`, g.concepto, g.total, g.items, '#5dcaa5')}</div>
              )}
              {/* Totales */}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', borderTop: '2px solid var(--border-strong)', fontWeight: 'bold', fontSize: 14 }}>
                <span>Total período</span>
                <strong style={{ color: '#5dcaa5' }}>{formatearMontoConSimbolo(datos.totalPeriodoIng)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 1rem', background: 'rgba(201,168,76,0.05)', fontSize: 13, alignItems: 'center', gap: 8 }}>
                <span style={{ color: datos.saldoAnteriorCalculado ? '#f09595' : 'var(--text-muted)' }}>
                  MÁS: Saldo anterior
                  {datos.saldoAnteriorCalculado && (
                    <span style={{ fontSize: 10, marginLeft: 6, color: '#f09595', fontStyle: 'italic', fontFamily: 'sans-serif' }}>
                      (calculado por diferencia — cartola no disponible)
                    </span>
                  )}
                </span>
                <strong style={{ color: datos.saldoAnteriorCalculado ? '#f09595' : 'var(--gold-light)' }}>{formatearMontoConSimbolo(datos.saldoAnterior)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.85rem 1rem', borderTop: '3px solid var(--gold)', fontWeight: 'bold', fontSize: 15, background: 'rgba(29,158,117,0.08)' }}>
                <span>TOTAL INGRESOS</span>
                <strong style={{ color: '#5dcaa5', fontSize: 16 }}>{formatearMontoConSimbolo(datos.totalIngresos)}</strong>
              </div>
            </div>

            {/* EGRESOS */}
            <div className="card">
              <div className="card-header" style={{ background: 'rgba(240,149,149,0.08)' }}>
                <div className="card-title" style={{ color: '#f09595' }}>
                  <i className="ti ti-trending-down"></i> Egresos
                </div>
              </div>
              {Object.values(datos.egresosAgrupados).length === 0 ? (
                <div className="empty-state" style={{ padding: '1.5rem 1rem' }}><i className="ti ti-receipt-off"></i>Sin egresos en este período</div>
              ) : (
                Object.values(datos.egresosAgrupados).map(g =>
                  <div key={g.concepto}>{renderFila(`eg-${g.concepto}`, g.concepto, g.total, g.items, '#f09595')}</div>
                )
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', borderTop: '2px solid var(--border-strong)', fontWeight: 'bold', fontSize: 14 }}>
                <span>Total egresos</span>
                <strong style={{ color: '#f09595' }}>{formatearMontoConSimbolo(datos.totalEgresos)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 1rem', background: 'rgba(201,168,76,0.05)', fontSize: 13, alignItems: 'center', gap: 8 }}>
                <span style={{ color: datos.saldoCtaCteCalculado ? '#f09595' : 'var(--text-muted)' }}>
                  MÁS: Saldo cta. cte.
                  {datos.saldoCtaCteCalculado && (
                    <span style={{ fontSize: 10, marginLeft: 6, color: '#f09595', fontStyle: 'italic', fontFamily: 'sans-serif' }}>
                      (calculado por diferencia — cartola no disponible)
                    </span>
                  )}
                </span>
                <strong style={{ color: datos.saldoCtaCteCalculado ? '#f09595' : 'var(--gold-light)' }}>{formatearMontoConSimbolo(datos.saldoCtaCte)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.85rem 1rem', borderTop: '3px solid var(--gold)', fontWeight: 'bold', fontSize: 15, background: 'rgba(240,149,149,0.08)' }}>
                <span>TOTAL EGRESOS + SALDO</span>
                <strong style={{ color: '#f09595', fontSize: 16 }}>{formatearMontoConSimbolo(datos.totalEgresosMasSaldo)}</strong>
              </div>
            </div>
          </div>

          {/* Cuadre */}
          <div className="card" style={{ marginTop: '1.5rem' }}>
            <div style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {cuadra ? (
                  <>
                    <i className="ti ti-circle-check" style={{ fontSize: 28, color: '#5dcaa5' }}></i>
                    <div>
                      <div style={{ fontSize: 15, color: '#5dcaa5', fontWeight: 'bold' }}>Totales iguales</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Ingresos coinciden con egresos + saldo</div>
                    </div>
                  </>
                ) : (
                  <>
                    <i className="ti ti-alert-triangle" style={{ fontSize: 28, color: '#fac775' }}></i>
                    <div>
                      <div style={{ fontSize: 15, color: '#fac775', fontWeight: 'bold' }}>Diferencia: {formatearMontoConSimbolo(Math.abs(diferencia))}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                        {diferencia > 0 ? 'Hay ingresos sin contraparte en egresos+saldo' : 'Hay egresos+saldo sin contraparte en ingresos'}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: 24, fontFamily: 'sans-serif' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Total ingresos</div>
                  <div style={{ fontSize: 16, fontWeight: 'bold', color: '#5dcaa5' }}>{formatearMontoConSimbolo(datos.totalIngresos)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Total egresos + saldo</div>
                  <div style={{ fontSize: 16, fontWeight: 'bold', color: '#f09595' }}>{formatearMontoConSimbolo(datos.totalEgresosMasSaldo)}</div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        .reporte-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
        @media (max-width: 768px) {
          .reporte-cols { grid-template-columns: 1fr; }
        }
        @media print {
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  )
}
