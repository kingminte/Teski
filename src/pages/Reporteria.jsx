import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { formatearMontoConSimbolo } from '../lib/montos'

const RELACIONES = [
  { value: 'conyuge', label: 'Cónyuge' },
  { value: 'hijo', label: 'Hijo/a' },
  { value: 'padre', label: 'Padre' },
  { value: 'madre', label: 'Madre' },
  { value: 'hermano', label: 'Hermano/a' },
  { value: 'otro', label: 'Otro' },
]

const relLabel = (v) => RELACIONES.find(r => r.value === v)?.label || v

const ordenBeneficiarios = (a, b) => {
  const prioridad = { conyuge: 0, hijo: 1, padre: 2, madre: 3, hermano: 4, otro: 5 }
  return (prioridad[a.relacion] ?? 9) - (prioridad[b.relacion] ?? 9)
}
const relStyle = (v) => v === 'conyuge'
  ? { background: 'rgba(55,138,221,0.15)', color: '#85b7eb' }
  : { background: 'rgba(239,159,39,0.15)', color: '#fac775' }

const AVATAR_COLORS = [
  { bg: 'rgba(83,74,183,0.3)', color: '#afa9ec' },
  { bg: 'rgba(29,158,117,0.2)', color: '#5dcaa5' },
  { bg: 'rgba(186,117,23,0.25)', color: '#fac775' },
  { bg: 'rgba(153,60,86,0.25)', color: '#ed93b1' },
  { bg: 'rgba(163,45,45,0.25)', color: '#f09595' },
]
const avatarColor = (str) => {
  let hash = 0
  for (let i = 0; i < (str || '').length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
const initials = (n, a) => `${n?.[0] || ''}${a?.[0] || ''}`

export default function Reporteria() {
  const { showToast, ToastComponent } = useToast()
  const [socios, setSocios] = useState([])
  const [periodos, setPeriodos] = useState([])
  const [pagos, setPagos] = useState([])
  const [beneficiarios, setBeneficiarios] = useState([])
  const [cheques, setCheques] = useState([])
  const [movimientos, setMovimientos] = useState([])
  const [loading, setLoading] = useState(true)
  const [socioSeleccionado, setSocioSeleccionado] = useState(null)
  const [tabActiva, setTabActiva] = useState('cuotas')
  const [subTabCuotas, setSubTabCuotas] = useState('social')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [busqueda, setBusqueda] = useState('')
  const [exportando, setExportando] = useState(false)

  const [incorporaciones, setIncorporaciones] = useState([])

  useEffect(() => {
    loadTodo()
  }, [])

  const loadTodo = async () => {
    setLoading(true)
    const [
      { data: s }, { data: p }, { data: pg },
      { data: b }, { data: ch }, { data: mv }, { data: inc }
    ] = await Promise.all([
      supabase.from('socios').select('*').order('numero_socio'),
      supabase.from('periodos_cuota').select('*').order('anio', { ascending: false }),
      supabase.from('pagos_cuota').select('*, cheques(numero,fecha_deposito,estado)').order('fecha_pago', { ascending: false }),
      supabase.from('beneficiarios').select('*').order('socio_id'),
      supabase.from('cheques').select('*').order('created_at', { ascending: false }),
      supabase.from('movimientos').select('*').eq('estado', 'conciliado').order('fecha', { ascending: false }),
      supabase.from('incorporaciones').select('*, cheques(numero,monto,banco_emisor,fecha_deposito,estado)').order('fecha', { ascending: false }),
    ])
    setSocios(s || [])
    setPeriodos(p || [])
    setPagos(pg || [])
    setBeneficiarios(b || [])
    setCheques(ch || [])
    setMovimientos(mv || [])
    setIncorporaciones(inc || [])
    setLoading(false)
  }

  // Resumen por socio
  const resumenSocio = (socio) => {
    const pagosSocio = pagos.filter(p => p.socio_id === socio.id)
    const totalPagado = pagosSocio.reduce((t, p) => t + p.monto, 0)
    const benesSocio = beneficiarios.filter(b => b.socio_id === socio.id).sort(ordenBeneficiarios)
    const chequesSocio = cheques.filter(c => c.socio_id === socio.id)
    const movsSocio = movimientos.filter(m => m.socio_id === socio.id)
    const incSocio = incorporaciones.filter(i => i.socio_id === socio.id)
    const periodoActual = periodos[0]
    const pagadoActual = pagosSocio.filter(p => p.periodo_id === periodoActual?.id).reduce((t,p) => t + p.monto, 0)
    const pct = periodoActual?.monto > 0 ? Math.round((pagadoActual / periodoActual.monto) * 100) : 0
    return { pagosSocio, totalPagado, benesSocio, chequesSocio, movsSocio, incSocio, pagadoActual, pct, periodoActual }
  }

  // Filtrar socios en lista
  const sociosFiltrados = socios.filter(s => {
    if (filtroEstado !== 'todos' && s.estado !== filtroEstado) return false
    if (!busqueda) return true
    const b = busqueda.toLowerCase()
    const enSocio = `${s.nombre} ${s.apellido} ${s.rut} ${s.numero_socio}`.toLowerCase().includes(b)
    const enBene = beneficiarios.filter(bene => bene.socio_id === s.id)
      .some(bene => `${bene.nombre} ${bene.apellido} ${bene.rut}`.toLowerCase().includes(b))
    return enSocio || enBene
  })

  const handleExportarFicha = async (socio) => {
    const { pagosSocio, benesSocio, chequesSocio, movsSocio } = resumenSocio(socio)
    setExportando(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()

      // Hoja 1: Info socio
      const infoRows = [
        ['N° Socio', socio.numero_socio],
        ['Nombre', `${socio.nombre} ${socio.apellido}`],
        ['RUT', socio.rut],
        ['Email', socio.email || ''],
        ['Teléfono', socio.telefono || ''],
        ['Estado', socio.estado],
        ['Fecha ingreso', socio.fecha_ingreso ? socio.fecha_ingreso.split('-').reverse().join('/') : ''],
        ['Banco', socio.banco || ''],
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(infoRows), 'Datos socio')

      // Hoja 2: Cuotas
      const periodoMap = {}
      periodos.forEach(p => periodoMap[p.id] = p.anio)
      const cuotaRows = [['Período', 'Monto', 'Fecha pago', 'Forma pago', 'Comentario']]
      pagosSocio.forEach(p => cuotaRows.push([
        periodoMap[p.periodo_id] || '',
        p.monto,
        p.fecha_pago ? p.fecha_pago.split('-').reverse().join('/') : '',
        p.forma_pago,
        p.comentario || '',
      ]))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cuotaRows), 'Cuotas')

      // Hoja 3: Beneficiarios
      const beneRows = [['Nombre', 'Apellido', 'RUT', 'Relación', 'F. nacimiento', 'Estado']]
      benesSocio.forEach(b => beneRows.push([
        b.nombre, b.apellido, b.rut, relLabel(b.relacion),
        b.fecha_nacimiento ? b.fecha_nacimiento.split('-').reverse().join('/') : '',
        b.estado,
      ]))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(beneRows), 'Beneficiarios')

      // Hoja 4: Cheques
      const chRows = [['N° Cheque', 'Monto', 'Concepto', 'F. depósito', 'Banco destino', 'Estado']]
      chequesSocio.forEach(c => chRows.push([
        c.numero, c.monto, c.concepto,
        c.fecha_deposito ? c.fecha_deposito.split('-').reverse().join('/') : '',
        c.banco_destino || '', c.estado,
      ]))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(chRows), 'Cheques')

      // Hoja 5: Movimientos
      const movRows = [['Fecha', 'Descripción', 'RUT detectado', 'Monto', 'Estado']]
      movsSocio.forEach(m => movRows.push([
        m.fecha ? m.fecha.split('-').reverse().join('/') : '',
        m.descripcion, m.rut_detectado || '',
        m.monto, m.estado,
      ]))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(movRows), 'Movimientos')

      XLSX.writeFile(wb, `Ficha_${socio.numero_socio}_${socio.apellido}.xlsx`)
      showToast('Ficha exportada correctamente')
    } catch (e) { showToast('Error al exportar', 'error') }
    setExportando(false)
  }

  if (loading) return <div className="empty-state"><i className="ti ti-loader"></i>Cargando datos…</div>

  // FICHA INDIVIDUAL
  if (socioSeleccionado) {
    const s = socioSeleccionado
    const { pagosSocio, totalPagado, benesSocio, chequesSocio, movsSocio, incSocio, pagadoActual, pct, periodoActual } = resumenSocio(s)
    const ac = avatarColor(s.nombre)
    const periodoMap = {}
    periodos.forEach(p => periodoMap[p.id] = p.anio)

    // Agrupar pagos por período
    const pagosPorPeriodo = {}
    pagosSocio.forEach(p => {
      const anio = periodoMap[p.periodo_id] || '—'
      if (!pagosPorPeriodo[anio]) pagosPorPeriodo[anio] = { monto: 0, pagos: [], cuota: periodos.find(per => per.id === p.periodo_id)?.monto || 0 }
      pagosPorPeriodo[anio].monto += p.monto
      pagosPorPeriodo[anio].pagos.push(p)
    })

    const pctColor = pct >= 100 ? '#5dcaa5' : pct > 0 ? '#fac775' : '#f09595'

    return (
      <div>
        {ToastComponent}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem', cursor: 'pointer', color: 'var(--text-muted)', fontFamily: 'sans-serif', fontSize: 13 }}
          onClick={() => { setSocioSeleccionado(null); setTabActiva('cuotas') }}>
          <i className="ti ti-arrow-left"></i> Volver a socios
        </div>

        {/* Header */}
        <div className="card">
          <div style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div className="avatar" style={{ width: 52, height: 52, background: ac.bg, color: ac.color, fontSize: 18 }}>
                {initials(s.nombre, s.apellido)}
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--gold-light)' }}>{s.nombre} {s.apellido}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                  {s.numero_socio} · {s.rut} · {s.estado} · Ingreso: {s.fecha_ingreso ? s.fecha_ingreso.split('-').reverse().join('/') : '—'}
                </div>
              </div>
            </div>
            <button className="btn" style={{ color: '#5dcaa5', borderColor: 'rgba(29,158,117,0.4)' }}
              onClick={() => handleExportarFicha(s)} disabled={exportando}>
              {exportando ? <><i className="ti ti-loader"></i> Exportando…</> : <><i className="ti ti-file-spreadsheet"></i> Exportar ficha completa</>}
            </button>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, padding: '0 1.25rem 1.25rem' }}>
            <div style={{ background: 'var(--navy-mid)', borderRadius: 8, padding: '0.85rem 1rem' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>
                Cuota {periodoActual?.anio}
              </div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: pctColor }}>{formatearMontoConSimbolo(pagadoActual)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 2 }}>
                {pct >= 100 ? 'Pagado completo' : pct > 0 ? `Parcial (${pct}%)` : 'Sin pago'}
              </div>
              <div style={{ height: 4, background: 'rgba(201,168,76,0.15)', borderRadius: 2, marginTop: 6 }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: pctColor }}></div>
              </div>
            </div>
            <div style={{ background: 'var(--navy-mid)', borderRadius: 8, padding: '0.85rem 1rem' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Beneficiarios</div>
              <div style={{ fontSize: 20, fontWeight: 'bold' }}>{benesSocio.length}</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 2 }}>vigentes</div>
            </div>
            <div style={{ background: 'var(--navy-mid)', borderRadius: 8, padding: '0.85rem 1rem' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Cheques</div>
              <div style={{ fontSize: 20, fontWeight: 'bold' }}>{chequesSocio.length}</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 2 }}>
                {chequesSocio.filter(c => c.estado === 'por_depositar').length} por depositar
              </div>
            </div>
            <div style={{ background: 'var(--navy-mid)', borderRadius: 8, padding: '0.85rem 1rem' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Total histórico</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--gold-light)' }}>{formatearMontoConSimbolo(totalPagado)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 2 }}>{periodos.length} períodos</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', marginBottom: '1rem' }}>
          {[
            { id: 'cuotas', icon: 'ti-receipt', label: 'Cuotas' },
            { id: 'beneficiarios', icon: 'ti-heart', label: 'Beneficiarios' },
            { id: 'cheques', icon: 'ti-writing', label: 'Cheques' },
            { id: 'movimientos', icon: 'ti-file-spreadsheet', label: 'Movimientos cartola' },
          ].map(t => (
            <button key={t.id} onClick={() => setTabActiva(t.id)} style={{
              padding: '8px 16px', fontSize: 13, border: 'none', background: 'transparent',
              color: tabActiva === t.id ? 'var(--gold)' : 'var(--text-muted)',
              borderBottom: `2px solid ${tabActiva === t.id ? 'var(--gold)' : 'transparent'}`,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: 'sans-serif', fontWeight: tabActiva === t.id ? 'bold' : 'normal',
            }}>
              <i className={`ti ${t.icon}`}></i> {t.label}
            </button>
          ))}
        </div>

        {/* Tab Cuotas */}
        {tabActiva === 'cuotas' && (
          <div>
            {/* Sub-pestañas */}
            <div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
              <button className={`btn btn-sm${subTabCuotas === 'social' ? ' btn-primary' : ''}`} onClick={() => setSubTabCuotas('social')}>
                <i className="ti ti-receipt"></i> Cuota social
              </button>
              <button className={`btn btn-sm${subTabCuotas === 'incorporacion' ? ' btn-primary' : ''}`} onClick={() => setSubTabCuotas('incorporacion')}>
                <i className="ti ti-user-plus"></i> Incorporación
              </button>
            </div>

            {/* Sub-tab: Cuota social */}
            {subTabCuotas === 'social' && (
              <div className="card">
                <div className="card-header">
                  <div className="card-title"><i className="ti ti-receipt"></i> Historial de cuotas sociales — todos los períodos</div>
                </div>
                {Object.keys(pagosPorPeriodo).length === 0 && periodos.filter(per => {
                  const anioIngreso = s.fecha_ingreso ? parseInt(s.fecha_ingreso.slice(0, 4)) : null
                  return !anioIngreso || per.anio >= anioIngreso
                }).length === 0 ? (
                  <div className="empty-state"><i className="ti ti-receipt-off"></i>Sin períodos de cuota</div>
                ) : (
                  <table>
                    <thead><tr><th>Período</th><th>Cuota</th><th>Pagado</th><th>Pendiente</th><th>Estado</th><th>Último pago</th><th>Forma pago</th></tr></thead>
                    <tbody>
                      {periodos.filter(per => {
                        const anioIngreso = s.fecha_ingreso ? parseInt(s.fecha_ingreso.slice(0, 4)) : null
                        return !anioIngreso || per.anio >= anioIngreso
                      }).map(per => {
                        const dp = pagosPorPeriodo[per.anio]
                        if (!dp) return (
                          <tr key={per.id}>
                            <td>{per.anio}</td>
                            <td style={{ color: 'var(--text-muted)' }}>{formatearMontoConSimbolo(per.monto)}</td>
                            <td style={{ color: 'var(--text-dim)' }}>—</td>
                            <td style={{ color: '#fac775' }}>{formatearMontoConSimbolo(per.monto)}</td>
                            <td><span className="badge badge-inactive">Sin pago</span></td>
                            <td style={{ color: 'var(--text-dim)' }}>—</td>
                            <td>—</td>
                          </tr>
                        )
                        const pendiente = Math.max(0, per.monto - dp.monto)
                        const ultimoPago = dp.pagos[0]
                        return (
                          <tr key={per.id}>
                            <td style={{ fontWeight: 'bold' }}>{per.anio}</td>
                            <td style={{ color: 'var(--text-muted)' }}>{formatearMontoConSimbolo(per.monto)}</td>
                            <td style={{ color: '#5dcaa5', fontWeight: 'bold' }}>{formatearMontoConSimbolo(dp.monto)}</td>
                            <td style={{ color: pendiente > 0 ? '#fac775' : 'var(--text-dim)' }}>
                              {pendiente > 0 ? formatearMontoConSimbolo(pendiente) : '—'}
                            </td>
                            <td>
                              {dp.monto >= per.monto
                                ? <span className="badge badge-active">Al día</span>
                                : <span className="badge badge-pending">Parcial</span>}
                            </td>
                            <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                              {ultimoPago?.fecha_pago ? ultimoPago.fecha_pago.split('-').reverse().join('/') : '—'}
                            </td>
                            <td>
                              {ultimoPago && <span className="chip" style={{ fontSize: 11 }}>{ultimoPago.forma_pago}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Sub-tab: Incorporación */}
            {subTabCuotas === 'incorporacion' && (() => {
              const chequesInc = chequesSocio.filter(c => c.concepto === 'incorporacion')
              const totalInc = chequesInc.reduce((t, c) => t + c.monto, 0)
              const cobrados = chequesInc.filter(c => c.estado === 'depositado')
              const pendientes = chequesInc.filter(c => c.estado === 'por_depositar')
              const totalCobrado = cobrados.reduce((t, c) => t + c.monto, 0)
              const totalPendiente = pendientes.reduce((t, c) => t + c.monto, 0)

              return (
                <div className="card">
                  <div className="card-header">
                    <div className="card-title"><i className="ti ti-user-plus"></i> Cheques de incorporación</div>
                  </div>

                  {chequesInc.length === 0 ? (
                    <div className="empty-state"><i className="ti ti-user-off"></i>Sin cheques de incorporación registrados</div>
                  ) : (
                    <>
                      {/* Resumen */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, padding: '1rem 1.25rem', borderBottom: '0.5px solid var(--border)' }}>
                        <div style={{ background: 'var(--navy-mid)', borderRadius: 8, padding: '0.75rem 1rem' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Total cheques</div>
                          <div style={{ fontSize: 20, fontWeight: 'bold' }}>{chequesInc.length}</div>
                        </div>
                        <div style={{ background: 'var(--navy-mid)', borderRadius: 8, padding: '0.75rem 1rem' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Monto total</div>
                          <div style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--gold-light)' }}>{formatearMontoConSimbolo(totalInc)}</div>
                        </div>
                        <div style={{ background: 'var(--navy-mid)', borderRadius: 8, padding: '0.75rem 1rem' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Cobrado ({cobrados.length})</div>
                          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#5dcaa5' }}>{formatearMontoConSimbolo(totalCobrado)}</div>
                        </div>
                        <div style={{ background: 'var(--navy-mid)', borderRadius: 8, padding: '0.75rem 1rem' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Por cobrar ({pendientes.length})</div>
                          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#fac775' }}>{formatearMontoConSimbolo(totalPendiente)}</div>
                        </div>
                      </div>

                      {/* Tabla de cheques */}
                      <table>
                        <thead>
                          <tr>
                            <th>N° Cheque</th>
                            <th>Monto</th>
                            <th>Banco destino</th>
                            <th>F. depósito</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chequesInc.map(c => (
                            <tr key={c.id}>
                              <td><span className="chip">{c.numero}</span></td>
                              <td style={{ color: '#5dcaa5', fontWeight: 'bold' }}>{formatearMontoConSimbolo(c.monto)}</td>
                              <td style={{ color: 'var(--text-muted)' }}>{c.banco_destino || '—'}</td>
                              <td style={{ color: 'var(--text-muted)' }}>{c.fecha_deposito ? c.fecha_deposito.split('-').reverse().join('/') : '—'}</td>
                              <td>
                                {c.estado === 'depositado' && <span className="badge badge-active">Depositado</span>}
                                {c.estado === 'por_depositar' && <span className="badge badge-pending">Por depositar</span>}
                                {c.estado === 'anulado' && <span className="badge badge-inactive">Anulado</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {/* Tab Beneficiarios */}
        {tabActiva === 'beneficiarios' && (
          <div className="card">
            <div className="card-header">
              <div className="card-title"><i className="ti ti-heart"></i> Beneficiarios</div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{benesSocio.length} registrados</span>
            </div>
            {benesSocio.length === 0 ? (
              <div className="empty-state"><i className="ti ti-heart-off"></i>Sin beneficiarios</div>
            ) : benesSocio.map(b => {
              const bc = avatarColor(b.nombre)
              return (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1.5rem', borderBottom: '0.5px solid rgba(201,168,76,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="avatar" style={{ width: 36, height: 36, background: bc.bg, color: bc.color, fontSize: 12 }}>
                      {initials(b.nombre, b.apellido)}
                    </div>
                    <div>
                      <div style={{ fontSize: 13 }}>{b.nombre} {b.apellido}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
                        {b.rut}{b.fecha_nacimiento && ` · Nac. ${b.fecha_nacimiento.split('-').reverse().join('/')}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ ...relStyle(b.relacion), padding: '2px 8px', borderRadius: 4, fontSize: 11, fontFamily: 'sans-serif' }}>
                      {relLabel(b.relacion)}
                    </span>
                    <span className={`badge ${b.estado === 'vigente' ? 'badge-active' : 'badge-inactive'}`}>
                      {b.estado === 'vigente' ? 'Vigente' : 'Inactivo'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Tab Cheques */}
        {tabActiva === 'cheques' && (
          <div className="card">
            <div className="card-header"><div className="card-title"><i className="ti ti-writing"></i> Cheques asociados</div></div>
            {chequesSocio.length === 0 ? (
              <div className="empty-state"><i className="ti ti-writing"></i>Sin cheques asociados</div>
            ) : (
              <table>
                <thead><tr><th>N° Cheque</th><th>Monto</th><th>Concepto</th><th>F. depósito</th><th>Banco destino</th><th>Estado</th></tr></thead>
                <tbody>
                  {chequesSocio.map(c => (
                    <tr key={c.id}>
                      <td><span className="chip">{c.numero}</span></td>
                      <td style={{ color: '#5dcaa5', fontWeight: 'bold' }}>{formatearMontoConSimbolo(c.monto)}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{c.concepto}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{c.fecha_deposito ? c.fecha_deposito.split('-').reverse().join('/') : '—'}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{c.banco_destino || '—'}</td>
                      <td>
                        {c.estado === 'depositado' && <span className="badge badge-active">Depositado</span>}
                        {c.estado === 'por_depositar' && <span className="badge badge-pending">Por depositar</span>}
                        {c.estado === 'anulado' && <span className="badge badge-inactive">Anulado</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab Movimientos */}
        {tabActiva === 'movimientos' && (
          <div className="card">
            <div className="card-header">
              <div className="card-title"><i className="ti ti-file-spreadsheet"></i> Movimientos bancarios conciliados</div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Abonos vinculados desde cartola</span>
            </div>
            {movsSocio.length === 0 ? (
              <div className="empty-state"><i className="ti ti-list-off"></i>Sin movimientos conciliados para este socio</div>
            ) : (
              <table>
                <thead><tr><th>Fecha</th><th>Descripción</th><th>RUT detectado</th><th>Monto</th><th>Estado</th></tr></thead>
                <tbody>
                  {movsSocio.map(m => (
                    <tr key={m.id}>
                      <td style={{ color: 'var(--text-muted)' }}>{m.fecha ? m.fecha.split('-').reverse().join('/') : '—'}</td>
                      <td style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{m.descripcion}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{m.rut_detectado || '—'}</td>
                      <td style={{ color: '#5dcaa5', fontWeight: 'bold' }}>{formatearMontoConSimbolo(m.monto)}</td>
                      <td><span className="badge badge-active">Conciliado</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    )
  }

  // LISTA DE SOCIOS
  return (
    <div>
      {ToastComponent}

      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-users"></i> Socios — haz clic para ver ficha completa</div>
        </div>

        <div style={{ padding: '0.75rem 1.25rem', borderBottom: '0.5px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Estado:</span>
          {['todos','activo','inactivo','pendiente'].map(f => (
            <button key={f} className={`btn btn-sm${filtroEstado === f ? ' btn-primary' : ''}`} onClick={() => setFiltroEstado(f)}>
              {f === 'todos' ? 'Todos' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <div className="search-box" style={{ marginLeft: 'auto' }}>
            <i className="ti ti-search"></i>
            <input placeholder="Buscar socio o beneficiario…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
          </div>
        </div>

        <div style={{ padding: '0.4rem 1.25rem', borderBottom: '0.5px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
          {sociosFiltrados.length} socios
        </div>

        {sociosFiltrados.length === 0 ? (
          <div className="empty-state"><i className="ti ti-users-off"></i>Sin resultados</div>
        ) : sociosFiltrados.map(s => {
          const { pagadoActual, pct, benesSocio, chequesSocio, periodoActual } = resumenSocio(s)
          const ac = avatarColor(s.nombre)
          const pctColor = pct >= 100 ? '#5dcaa5' : pct > 0 ? '#fac775' : '#f09595'

          return (
            <div key={s.id}
              onClick={() => setSocioSeleccionado(s)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.85rem 1.5rem', borderBottom: '0.5px solid rgba(201,168,76,0.08)',
                cursor: 'pointer', transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(201,168,76,0.04)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="avatar" style={{ width: 38, height: 38, background: ac.bg, color: ac.color, fontSize: 13 }}>
                  {initials(s.nombre, s.apellido)}
                </div>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: 14 }}>{s.nombre} {s.apellido}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>{s.numero_socio} · {s.rut}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {s.estado === 'activo' && <span className="badge badge-active">Activo</span>}
                {s.estado === 'inactivo' && <span className="badge badge-inactive">Inactivo</span>}
                {s.estado === 'pendiente' && <span className="badge badge-pending">Pendiente</span>}
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{benesSocio.length} beneficiarios</span>
                <span style={{ fontSize: 12, color: pctColor, fontFamily: 'sans-serif', fontWeight: 'bold' }}>
                  {formatearMontoConSimbolo(pagadoActual)} {periodoActual?.anio}
                </span>
                {chequesSocio.filter(c => c.estado === 'por_depositar').length > 0 && (
                  <span style={{ fontSize: 11, color: '#fac775', fontFamily: 'sans-serif' }}>
                    <i className="ti ti-writing" style={{ fontSize: 12 }}></i> {chequesSocio.filter(c => c.estado === 'por_depositar').length} cheque(s)
                  </span>
                )}
                <i className="ti ti-chevron-right" style={{ color: 'var(--text-dim)', fontSize: 16 }}></i>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
