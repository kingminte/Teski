import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatearMontoConSimbolo } from '../lib/montos'

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: 'sans-serif', marginBottom: 8 }}>
        <i className={`ti ${icon}`} style={{ fontSize: 14 }}></i> {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 'bold', color: color || 'var(--gold-light)' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'sans-serif' }}>{sub}</div>}
    </div>
  )
}

function AlertCard({ icon, label, value, sub, color, bg, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: bg, border: `0.5px solid ${color}40`,
      borderRadius: 10, padding: '1.25rem',
      cursor: onClick ? 'pointer' : 'default',
      transition: 'transform 0.15s',
    }}
    onMouseEnter={e => { if (onClick) e.currentTarget.style.transform = 'translateY(-2px)' }}
    onMouseLeave={e => { if (onClick) e.currentTarget.style.transform = 'translateY(0)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color, letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: 'sans-serif', marginBottom: 8, fontWeight: 'bold' }}>
        <i className={`ti ${icon}`} style={{ fontSize: 14 }}></i> {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 'bold', color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'sans-serif' }}>{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [periodos, setPeriodos] = useState([])
  const [selectedPeriodo, setSelectedPeriodo] = useState(null)
  const [stats, setStats] = useState({ total: 0, alDia: 0, conPagoParcial: 0, sinPago: 0, vencidas: 0, recaudado: 0, chequesCount: 0, chequesTotal: 0 })
  const [ultimosPagos, setUltimosPagos] = useState([])
  const [ultimaCartola, setUltimaCartola] = useState(null)
  const [loading, setLoading] = useState(true)

  // Cargar períodos al inicio
  useEffect(() => {
    supabase.from('periodos_cuota').select('*').order('anio', { ascending: false })
      .then(({ data }) => {
        setPeriodos(data || [])
        if (data?.length > 0) setSelectedPeriodo(data[0])
      })
    supabase.from('cartolas').select('*').order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => setUltimaCartola(data?.[0] || null))
  }, [])

  // Recargar stats cuando cambia el período
  useEffect(() => {
    if (!selectedPeriodo) return
    loadStats(selectedPeriodo)
  }, [selectedPeriodo])

  const loadStats = async (periodo) => {
    setLoading(true)
    const anio = periodo.anio

    // Traer socios filtrados por año directamente desde Supabase
    const { data: sociosFiltrados } = await supabase
      .from('socios')
      .select('id, nombre, apellido, estado, fecha_ingreso, fecha_inactividad')
      .lte('fecha_ingreso', `${anio}-12-31`)

    // Filtrar inactivos que se fueron antes del año
    const sociosDelAnio = (sociosFiltrados || []).filter(s => {
      if (s.estado === 'inactivo' && s.fecha_inactividad) {
        const anioInactividad = parseInt(s.fecha_inactividad.slice(0, 4))
        if (anioInactividad < anio) return false
      }
      return true
    })

    const socioIds = sociosDelAnio.map(s => s.id)

    // Pagos del período para esos socios
    const { data: pagos } = await supabase
      .from('pagos_cuota')
      .select('socio_id, monto, concepto')
      .eq('periodo_id', periodo.id)
      .in('socio_id', socioIds.length > 0 ? socioIds : ['no-match'])

    // Últimos pagos con nombre
    const { data: ultimosPagosData } = await supabase
      .from('pagos_cuota')
      .select('*, socios(nombre, apellido)')
      .eq('periodo_id', periodo.id)
      .order('fecha_pago', { ascending: false })
      .limit(5)

    // Cheques recibidos pendientes de cobro
    const { data: chequesData } = await supabase
      .from('cheques')
      .select('monto')
      .eq('estado', 'por_depositar')

    // Calcular stats
    // Estados (alDia/parcial/sinPago) se basan SOLO en cuota social (excluye incorporación)
    const esCuota = (p) => !p.concepto || p.concepto.toLowerCase().includes('cuota')
    const pagosPorSocioCuota = {}
    ;(pagos || []).forEach(p => {
      if (esCuota(p)) pagosPorSocioCuota[p.socio_id] = (pagosPorSocioCuota[p.socio_id] || 0) + p.monto
    })

    const total = sociosDelAnio.length
    const alDia = sociosDelAnio.filter(s => (pagosPorSocioCuota[s.id] || 0) >= periodo.monto).length
    const conPagoParcial = sociosDelAnio.filter(s => (pagosPorSocioCuota[s.id] || 0) > 0 && (pagosPorSocioCuota[s.id] || 0) < periodo.monto).length
    const sinPago = sociosDelAnio.filter(s => (pagosPorSocioCuota[s.id] || 0) === 0).length
    // Recaudado total: incluye todos los conceptos (cuota + incorporación)
    const recaudado = (pagos || []).reduce((t, p) => t + p.monto, 0)

    // Vencidas: $0 pagado y más de 60 días desde el 1-ene del año del período
    const inicioPeriodo = new Date(`${anio}-01-01`)
    const hoy = new Date()
    const diasDesdeInicio = Math.floor((hoy - inicioPeriodo) / 86400000)
    const vencidas = diasDesdeInicio > 60
      ? sociosDelAnio.filter(s => (pagosPorSocioCuota[s.id] || 0) === 0).length
      : 0

    const chequesCount = (chequesData || []).length
    const chequesTotal = (chequesData || []).reduce((t, c) => t + (c.monto || 0), 0)

    setStats({ total, alDia, conPagoParcial, sinPago, vencidas, recaudado, chequesCount, chequesTotal })
    setUltimosPagos(ultimosPagosData || [])
    setLoading(false)
  }

  const pct = stats.total > 0 ? Math.round((stats.alDia / stats.total) * 100) : 0

  return (
    <div>
      {/* Selector de período */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.5rem' }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Período:</label>
        <select
          value={selectedPeriodo?.id || ''}
          onChange={e => setSelectedPeriodo(periodos.find(p => p.id === e.target.value))}
          style={{ width: 'auto', fontSize: 13 }}
        >
          {periodos.map(p => <option key={p.id} value={p.id}>{p.anio} — ${p.monto.toLocaleString('es-CL')}</option>)}
        </select>
        {selectedPeriodo && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
            Mostrando {stats.total} socios activos en {selectedPeriodo.anio}
          </span>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: '2rem' }}>
        <StatCard icon="ti-users" label="Socios del período" value={loading ? '—' : stats.total} sub={selectedPeriodo ? `Activos en ${selectedPeriodo.anio}` : ''} />
        <StatCard icon="ti-check" label="Al día" value={loading ? '—' : stats.alDia} sub={`${pct}% del total`} color="#5dcaa5" />
        <StatCard icon="ti-clock" label="Pago parcial" value={loading ? '—' : stats.conPagoParcial} color="#fac775" />
        <StatCard icon="ti-coin" label="Recaudado" value={loading ? '—' : formatearMontoConSimbolo(stats.recaudado)} sub={selectedPeriodo ? `Período ${selectedPeriodo.anio}` : ''} />
      </div>

      {/* Alertas */}
      <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: 2, textTransform: 'uppercase', fontFamily: 'sans-serif', marginBottom: 10 }}>
        Alertas
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: '2rem' }}>
        <AlertCard
          icon="ti-alert-triangle"
          label="Cuotas vencidas"
          value={loading ? '—' : stats.vencidas}
          sub={stats.vencidas > 0 ? 'Más de 60 días sin pago' : 'Sin atrasos significativos'}
          color="#f09595"
          bg="rgba(226,75,74,0.08)"
          onClick={() => navigate('/cobranza')}
        />
        <AlertCard
          icon="ti-progress"
          label="Pago parcial"
          value={loading ? '—' : stats.conPagoParcial}
          sub={stats.conPagoParcial > 0 ? 'Pagaron menos que la cuota' : 'Sin pagos parciales'}
          color="#fac775"
          bg="rgba(239,159,39,0.08)"
          onClick={() => navigate('/cobranza')}
        />
        <AlertCard
          icon="ti-checkbook"
          label="Cheques por cobrar"
          value={loading ? '—' : stats.chequesCount}
          sub={stats.chequesCount > 0 ? formatearMontoConSimbolo(stats.chequesTotal) + ' acumulado' : 'Sin cheques pendientes'}
          color="#7fb3e8"
          bg="rgba(91,156,214,0.1)"
          onClick={() => navigate('/cheques')}
        />
        <AlertCard
          icon="ti-circle-check"
          label="Al día"
          value={loading ? '—' : stats.alDia}
          sub={`${pct}% del total`}
          color="#5dcaa5"
          bg="rgba(29,158,117,0.08)"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title"><i className="ti ti-clock"></i> Últimos pagos registrados</div>
            <button className="btn btn-sm" onClick={() => navigate('/cuotas')}>Ver todos</button>
          </div>
          {loading ? (
            <div className="empty-state"><i className="ti ti-loader"></i>Cargando...</div>
          ) : ultimosPagos.length === 0 ? (
            <div className="empty-state"><i className="ti ti-receipt-off"></i>Sin pagos registrados</div>
          ) : (
            <table>
              <thead><tr><th>Socio</th><th>Monto</th><th>Fecha</th></tr></thead>
              <tbody>
                {ultimosPagos.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div className="name-cell">
                        <div className="avatar" style={{ background: 'rgba(83,74,183,0.3)', color: '#afa9ec' }}>
                          {p.socios?.nombre?.[0]}{p.socios?.apellido?.[0]}
                        </div>
                        {p.socios?.nombre} {p.socios?.apellido}
                      </div>
                    </td>
                    <td className="amount-pos">{formatearMontoConSimbolo(p.monto)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {p.fecha_pago ? p.fecha_pago.split('-').reverse().join('/') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title"><i className="ti ti-chart-pie"></i> Estado — {selectedPeriodo?.anio}</div>
          </div>
          <div style={{ padding: '1.25rem' }}>
            {[
              { label: 'Al día', count: stats.alDia, color: '#5dcaa5', pct: stats.total > 0 ? Math.round((stats.alDia / stats.total) * 100) : 0 },
              { label: 'Pago parcial', count: stats.conPagoParcial, color: 'var(--warning)', pct: stats.total > 0 ? Math.round(((stats.conPagoParcial||0) / stats.total) * 100) : 0 },
              { label: 'Sin pago', count: stats.sinPago, color: '#f09595', pct: stats.total > 0 ? Math.round(((stats.sinPago||0) / stats.total) * 100) : 0 },
            ].map(row => (
              <div key={row.label} style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontFamily: 'sans-serif', marginBottom: 4 }}>
                  <span style={{ color: row.color }}>{row.label}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{row.count || 0} socios</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${row.pct}%`, background: row.color }}></div>
                </div>
              </div>
            ))}

            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '0.5px solid var(--border)', fontFamily: 'sans-serif' }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Última cartola cargada</div>
              {ultimaCartola ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i className="ti ti-file-check" style={{ color: 'var(--gold)', fontSize: 18 }}></i>
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--gold-light)' }}>{ultimaCartola.nombre_archivo}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      {new Date(ultimaCartola.created_at).toLocaleDateString('es-CL')} — {ultimaCartola.total_movimientos} movimientos
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Sin cartola cargada</div>
              )}
              <button className="btn btn-sm" style={{ marginTop: '0.75rem' }} onClick={() => navigate('/cartola')}>
                <i className="ti ti-upload"></i> Cargar cartola
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
