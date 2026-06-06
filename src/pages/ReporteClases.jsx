import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import { formatearMontoConSimbolo } from '../lib/montos'

const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const fmtFecha = (iso) => iso ? iso.split('-').reverse().join('/') : ''
const hhmm = (t) => (t || '').slice(0, 5)
const duracionHorasDe = (g) => {
  const toMin = (t) => { const [h, m] = (t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
  return Math.max(0, Math.round(((toMin(g.hora_fin) - toMin(g.hora_inicio)) / 60) * 10) / 10)
}
const fmtHoras = (h) => (Number.isInteger(h) ? String(h) : String(Math.round(h * 10) / 10).replace('.', ','))
const labelHoras = (h) => `${fmtHoras(h)} h-prof`
const parseAjuste = (txt) => parseInt(String(txt).replace(/[^\d-]/g, ''), 10) || 0

const ESTADO_CORTE = {
  abierto: { bg: 'rgba(239,159,39,0.15)', color: '#fac775', txt: 'Abierto' },
  cerrado: { bg: 'rgba(55,138,221,0.15)', color: '#85b7eb', txt: 'Cerrado' },
  pagado: { bg: 'rgba(29,158,117,0.15)', color: '#5dcaa5', txt: 'Pagado' },
}
const TipoBadge = ({ tipo }) => (
  <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 7px', borderRadius: 4, background: tipo === 'snowboard' ? 'rgba(175,169,236,0.15)' : 'rgba(55,138,221,0.15)', color: tipo === 'snowboard' ? '#afa9ec' : '#85b7eb' }}>
    {tipo === 'snowboard' ? 'Snowboard' : 'Esquí'}
  </span>
)

export default function ReporteClases() {
  const { showToast, ToastComponent } = useToast()
  const { puedeEditar, user } = useAuth()
  const editable = puedeEditar('clases_reporte')
  const esAdmin = user?.rol === 'admin'

  const [cortes, setCortes] = useState([])
  const [corteSelId, setCorteSelId] = useState('')
  const [config, setConfig] = useState({ tarifa_hora_profesor: 0 })
  const [grupos, setGrupos] = useState([])
  const [asisPorGrupo, setAsisPorGrupo] = useState({})   // grupo_id -> { total, asistieron }
  const [huerfanas, setHuerfanas] = useState([])         // grupos realizada con corte_id null
  const [loading, setLoading] = useState(true)
  const [showHuerfanas, setShowHuerfanas] = useState(false)
  const [exportando, setExportando] = useState(false)

  // Modales
  const [showCerrar, setShowCerrar] = useState(false)
  const [fechaFin, setFechaFin] = useState(hoyISO())
  const [showAjuste, setShowAjuste] = useState(false)
  const [ajusteText, setAjusteText] = useState('')
  const [comentarioAjuste, setComentarioAjuste] = useState('')
  const [showPagar, setShowPagar] = useState(false)
  const [refPago, setRefPago] = useState('')
  const [comentarioPago, setComentarioPago] = useState('')
  const [showAbrir, setShowAbrir] = useState(false)
  const [fechaInicio, setFechaInicio] = useState(hoyISO())
  const [incluirHuerfanas, setIncluirHuerfanas] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { loadCortes() }, [])
  useEffect(() => { if (corteSelId) loadDetalle(corteSelId) }, [corteSelId])

  const loadCortes = async () => {
    setLoading(true)
    const [{ data: cs }, { data: cfg }, { data: huer }] = await Promise.all([
      supabase.from('clases_cortes_pago').select('*').order('numero', { ascending: false }),
      supabase.from('clases_config').select('*').eq('id', 1).maybeSingle(),
      supabase.from('clases_grupos').select('*, clases_profesores(nombre)').is('corte_id', null).eq('estado', 'realizada').order('fecha'),
    ])
    const lista = cs || []
    setCortes(lista)
    if (cfg) setConfig(cfg)
    setHuerfanas(huer || [])
    const abierto = lista.find(c => c.estado === 'abierto')
    const inicial = (abierto || lista[0] || {}).id || ''
    setCorteSelId(inicial)
    if (!inicial) setLoading(false)
  }

  const loadDetalle = async (corteId) => {
    setLoading(true)
    const { data: grps } = await supabase.from('clases_grupos').select('*, clases_profesores(nombre)').eq('corte_id', corteId).order('fecha').order('hora_inicio')
    const lista = grps || []
    const ids = lista.map(g => g.id)
    const mapa = {}
    if (ids.length) {
      const { data: asis } = await supabase.from('clases_asistencia').select('grupo_id,asistio').in('grupo_id', ids)
      ;(asis || []).forEach(a => {
        if (!mapa[a.grupo_id]) mapa[a.grupo_id] = { total: 0, asistieron: 0 }
        mapa[a.grupo_id].total++
        if (a.asistio) mapa[a.grupo_id].asistieron++
      })
    }
    setGrupos(lista)
    setAsisPorGrupo(mapa)
    setLoading(false)
  }

  const corte = cortes.find(c => c.id === corteSelId)
  const realizadas = grupos.filter(g => g.estado === 'realizada')
  const noRealizadas = grupos.filter(g => g.estado === 'no_realizada')
  const tarifa = corte ? (corte.estado === 'abierto' ? (config.tarifa_hora_profesor || 0) : (corte.tarifa_snapshot ?? 0)) : 0
  const horas = realizadas.reduce((t, g) => t + duracionHorasDe(g), 0)
  const asistencias = realizadas.reduce((t, g) => t + (asisPorGrupo[g.id]?.asistieron || 0), 0)
  const ajuste = corte?.ajuste || 0
  const montoCalc = corte && corte.estado !== 'abierto' ? (corte.monto_calculado || 0) : Math.round(horas * tarifa)
  const aPagar = corte && corte.estado !== 'abierto' ? (corte.monto_final || 0) : Math.round(horas * tarifa) + ajuste
  const montoClase = (g) => Math.round(duracionHorasDe(g) * tarifa)

  // Por disciplina
  const porDisc = ['esqui', 'snowboard'].map(tipo => {
    const gs = realizadas.filter(g => g.tipo === tipo)
    return { tipo, horas: gs.reduce((t, g) => t + duracionHorasDe(g), 0), asist: gs.reduce((t, g) => t + (asisPorGrupo[g.id]?.asistieron || 0), 0), clases: gs.length }
  })
  // Por profesor
  const porProf = Object.values(realizadas.reduce((acc, g) => {
    const key = g.profesor_id || 'sin'
    if (!acc[key]) acc[key] = { nombre: g.clases_profesores?.nombre || 'Sin asignar', horas: 0, monto: 0, clases: 0 }
    acc[key].horas += duracionHorasDe(g)
    acc[key].monto += montoClase(g)
    acc[key].clases++
    return acc
  }, {})).sort((a, b) => b.horas - a.horas)

  // ----- Acciones -----
  const reload = async () => { await loadCortes() }

  const handleAbrir = async () => {
    setGuardando(true)
    const esPrimero = cortes.length === 0
    const { data, error } = await supabase.rpc('abrir_corte_pago', { p_fecha_inicio: fechaInicio, p_usuario_id: user?.id || null })
    if (error) { setGuardando(false); showToast('Error al abrir corte: ' + error.message, 'error'); return }
    const nuevoId = data
    // Backfill SOLO en el primer corte
    if (esPrimero && incluirHuerfanas && huerfanas.length > 0) {
      const { error: e2 } = await supabase.from('clases_grupos').update({ corte_id: nuevoId }).is('corte_id', null).in('estado', ['realizada', 'no_realizada'])
      if (e2) showToast('Corte creado, pero falló asignar clases huérfanas: ' + e2.message, 'error')
    }
    setGuardando(false)
    setShowAbrir(false)
    showToast('Corte abierto')
    await loadCortes()
    setCorteSelId(nuevoId)
  }

  const handleCerrar = async () => {
    setGuardando(true)
    const { error } = await supabase.rpc('cerrar_corte_pago', { p_corte_id: corteSelId, p_fecha_fin: fechaFin, p_usuario_id: user?.id || null })
    setGuardando(false)
    if (error) { showToast('Error al cerrar: ' + error.message, 'error'); return }
    setShowCerrar(false); showToast('Corte cerrado'); reload()
  }

  const handleAjuste = async () => {
    const n = parseAjuste(ajusteText)
    if (n !== 0 && !comentarioAjuste.trim()) { showToast('El comentario es obligatorio cuando hay ajuste', 'error'); return }
    setGuardando(true)
    const { error } = await supabase.rpc('actualizar_ajuste_corte', { p_corte_id: corteSelId, p_ajuste: n, p_comentario: comentarioAjuste || null, p_usuario_id: user?.id || null })
    setGuardando(false)
    if (error) { showToast('Error al ajustar: ' + error.message, 'error'); return }
    setShowAjuste(false); showToast('Ajuste guardado'); reload()
  }

  const handlePagar = async () => {
    if (!refPago.trim()) { showToast('La referencia de pago es obligatoria', 'error'); return }
    setGuardando(true)
    const { error } = await supabase.rpc('marcar_corte_pagado', { p_corte_id: corteSelId, p_referencia: refPago, p_comentario: comentarioPago || null, p_usuario_id: user?.id || null })
    setGuardando(false)
    if (error) { showToast('Error al marcar pagado: ' + error.message, 'error'); return }
    setShowPagar(false); showToast('Corte marcado como pagado'); reload()
  }

  const handleRevertir = async () => {
    if (!confirm('¿Revertir este corte de "Pagado" a "Cerrado"?')) return
    const { error } = await supabase.rpc('revertir_corte_pagado', { p_corte_id: corteSelId, p_usuario_id: user?.id || null })
    if (error) { showToast('Error al revertir: ' + error.message, 'error'); return }
    showToast('Corte revertido a cerrado'); reload()
  }

  const handleExportar = async () => {
    if (realizadas.length === 0) { showToast('No hay clases realizadas para exportar', 'error'); return }
    setExportando(true)
    try {
      const XLSX = await import('xlsx')
      const rows = realizadas.map(g => ({
        Fecha: fmtFecha(g.fecha),
        Horario: `${hhmm(g.hora_inicio)}-${hhmm(g.hora_fin)}`,
        Tipo: g.tipo === 'snowboard' ? 'Snowboard' : 'Esquí',
        Profesor: g.clases_profesores?.nombre || 'Sin asignar',
        Asistencias: asisPorGrupo[g.id]?.asistieron || 0,
        Total: asisPorGrupo[g.id]?.total || 0,
        'Horas-profesor': duracionHorasDe(g),
        Monto: montoClase(g),
      }))
      rows.push({})
      rows.push({ Fecha: 'TOTAL', 'Horas-profesor': horas, Monto: montoCalc })
      if (ajuste) rows.push({ Fecha: 'Ajuste', Monto: ajuste })
      rows.push({ Fecha: 'A pagar', Monto: aPagar })
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, `Corte ${corte?.numero || ''}`)
      XLSX.writeFile(wb, `reporte_clases_corte_${corte?.numero || 'x'}.xlsx`)
    } catch (e) {
      showToast('Error al exportar: ' + e.message, 'error')
    }
    setExportando(false)
  }

  const openAjuste = () => { setAjusteText(ajuste ? String(ajuste) : ''); setComentarioAjuste(corte?.comentario_ajuste || ''); setShowAjuste(true) }
  const ajustePreview = montoCalc + parseAjuste(ajusteText)

  if (loading && cortes.length === 0) return <div className="card"><div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div></div>

  return (
    <div>
      {ToastComponent}

      {/* Header */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-report-money"></i> Reporte de clases de esquí</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {cortes.length > 0 && (
              <select value={corteSelId} onChange={e => setCorteSelId(e.target.value)} style={{ width: 'auto', fontSize: 13 }}>
                {cortes.map(c => (
                  <option key={c.id} value={c.id}>
                    Corte #{c.numero} — {c.estado === 'abierto' ? `abierto desde ${fmtFecha(c.fecha_inicio)}` : `${fmtFecha(c.fecha_inicio)} al ${fmtFecha(c.fecha_fin)}`} — {ESTADO_CORTE[c.estado]?.txt}
                  </option>
                ))}
              </select>
            )}
            {editable && !cortes.some(c => c.estado === 'abierto') && cortes.length > 0 && (
              <button className="btn btn-primary btn-sm" onClick={() => { setFechaInicio(hoyISO()); setShowAbrir(true) }}>
                <i className="ti ti-plus"></i> Abrir nuevo corte
              </button>
            )}
            {corte && realizadas.length > 0 && (
              <button className="btn btn-sm" onClick={handleExportar} disabled={exportando}>
                {exportando ? <><i className="ti ti-loader"></i></> : <><i className="ti ti-file-spreadsheet"></i> Excel</>}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sin cortes */}
      {cortes.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ flexDirection: 'column', gap: 12 }}>
            <i className="ti ti-cash-off" style={{ color: 'var(--gold-dim)' }}></i>
            <div style={{ maxWidth: 480, textAlign: 'center' }}>No hay cortes de pago creados. Andacor no puede marcar clases como realizadas hasta que abras el primer corte.</div>
            {editable && (
              <button className="btn btn-primary" onClick={() => { setFechaInicio(hoyISO()); setIncluirHuerfanas(true); setShowAbrir(true) }}>
                <i className="ti ti-plus"></i> Crear primer corte
              </button>
            )}
          </div>
        </div>
      ) : corte && (
        <>
          {/* Header del corte */}
          <div className="card">
            <div style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16, fontWeight: 'bold', color: 'var(--gold-light)' }}>Corte #{corte.numero}</span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                  {corte.estado === 'abierto' ? `abierto desde ${fmtFecha(corte.fecha_inicio)}` : `${fmtFecha(corte.fecha_inicio)} – ${fmtFecha(corte.fecha_fin)}`}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: ESTADO_CORTE[corte.estado]?.bg, color: ESTADO_CORTE[corte.estado]?.color }}>{ESTADO_CORTE[corte.estado]?.txt}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {corte.estado === 'abierto' && editable && (
                  <button className="btn btn-sm btn-primary" onClick={() => { setFechaFin(hoyISO()); setShowCerrar(true) }}><i className="ti ti-lock"></i> Cerrar corte</button>
                )}
                {corte.estado === 'cerrado' && esAdmin && (
                  <>
                    <button className="btn btn-sm" onClick={openAjuste}><i className="ti ti-adjustments-dollar"></i> Editar ajuste</button>
                    <button className="btn btn-sm btn-primary" onClick={() => { setRefPago(''); setComentarioPago(''); setShowPagar(true) }}><i className="ti ti-cash"></i> Marcar como pagado</button>
                  </>
                )}
                {corte.estado === 'pagado' && esAdmin && (
                  <button className="btn btn-sm" onClick={handleRevertir}><i className="ti ti-arrow-back-up"></i> Revertir a cerrado</button>
                )}
              </div>
            </div>
            {corte.estado === 'pagado' && corte.referencia_pago && (
              <div style={{ padding: '0 1.5rem 1rem', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                <i className="ti ti-receipt"></i> Pago: {corte.referencia_pago}{corte.comentario_pago ? ` · ${corte.comentario_pago}` : ''}
              </div>
            )}
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: '1rem' }}>
            {[
              { label: 'Horas-profesor', value: fmtHoras(horas), color: 'var(--gold-light)' },
              { label: 'Clases realizadas', value: realizadas.length, color: '#85b7eb' },
              { label: 'Asistencias', value: asistencias, color: '#afa9ec' },
              { label: 'A pagar a Andacor', value: formatearMontoConSimbolo(aPagar), color: '#5dcaa5', sub: `${fmtHoras(horas)} × ${formatearMontoConSimbolo(tarifa)}${ajuste ? ` ${ajuste > 0 ? '+' : '−'} ${formatearMontoConSimbolo(Math.abs(ajuste))}` : ''}` },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                {s.sub && <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 4 }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* Banner no realizadas */}
          {noRealizadas.length > 0 && (
            <div style={{ padding: '0.7rem 0.9rem', borderRadius: 8, fontSize: 12, fontFamily: 'sans-serif', marginBottom: '1rem', background: 'rgba(239,159,39,0.1)', border: '0.5px solid rgba(239,159,39,0.3)', color: '#fac775' }}>
              <i className="ti ti-alert-triangle"></i> {noRealizadas.length} clase{noRealizadas.length === 1 ? '' : 's'} marcada{noRealizadas.length === 1 ? '' : 's'} como "No realizada" (nadie asistió). No se incluyen en el cobro.
            </div>
          )}

          {/* Cards disciplina / profesor */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: '1rem', alignItems: 'start' }}>
            <div className="card">
              <div className="card-header"><div className="card-title"><i className="ti ti-chart-pie"></i> Por disciplina</div></div>
              <div style={{ padding: '0.75rem 1.5rem 1.25rem' }}>
                {porDisc.map(d => (
                  <div key={d.tipo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '0.5px solid rgba(201,168,76,0.08)' }}>
                    <TipoBadge tipo={d.tipo} />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{d.clases} clases · {fmtHoras(d.horas)} h-prof · {d.asist} asist.</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><div className="card-title"><i className="ti ti-user-check"></i> Por profesor</div></div>
              <div style={{ padding: '0.75rem 1.5rem 1.25rem' }}>
                {porProf.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>Sin clases realizadas.</div> : porProf.map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '0.5px solid rgba(201,168,76,0.08)' }}>
                    <span style={{ fontSize: 13, color: '#c8d0dc' }}>{p.nombre}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{fmtHoras(p.horas)} h · {formatearMontoConSimbolo(p.monto)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tabla detallada */}
          <div className="card">
            <div className="card-header"><div className="card-title"><i className="ti ti-list-details"></i> Clases realizadas ({realizadas.length})</div></div>
            {realizadas.length === 0 ? (
              <div className="empty-state"><i className="ti ti-calendar-off"></i>No hay clases realizadas en este corte.</div>
            ) : (
              <table>
                <thead><tr><th>Fecha</th><th>Horario</th><th>Tipo</th><th>Profesor</th><th>Asist./Total</th><th>h-prof</th><th>Monto</th></tr></thead>
                <tbody>
                  {realizadas.map(g => {
                    const a = asisPorGrupo[g.id] || { total: 0, asistieron: 0 }
                    return (
                      <tr key={g.id}>
                        <td style={{ color: 'var(--text-muted)' }}>{fmtFecha(g.fecha)}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{hhmm(g.hora_inicio)}–{hhmm(g.hora_fin)}</td>
                        <td><TipoBadge tipo={g.tipo} /></td>
                        <td style={{ color: '#c8d0dc' }}>{g.clases_profesores?.nombre || '—'}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{a.asistieron}/{a.total}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{fmtHoras(duracionHorasDe(g))}</td>
                        <td style={{ color: '#5dcaa5', fontWeight: 'bold' }}>{formatearMontoConSimbolo(montoClase(g))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Sección colapsable: clases sin corte asignado (solo visibilidad) */}
          {huerfanas.length > 0 && (
            <div className="card" style={{ marginTop: '1rem' }}>
              <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => setShowHuerfanas(v => !v)}>
                <div className="card-title"><i className={`ti ${showHuerfanas ? 'ti-chevron-down' : 'ti-chevron-right'}`}></i> Clases sin corte asignado ({huerfanas.length})</div>
              </div>
              {showHuerfanas && (
                <div style={{ padding: '0 1.5rem 1rem' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginBottom: 8 }}>
                    Clases marcadas como realizadas que no quedaron asociadas a ningún corte. Se gestionan por SQL aparte (no se asignan automáticamente).
                  </div>
                  <table>
                    <thead><tr><th>Fecha</th><th>Horario</th><th>Tipo</th><th>Profesor</th></tr></thead>
                    <tbody>
                      {huerfanas.map(g => (
                        <tr key={g.id}>
                          <td style={{ color: 'var(--text-muted)' }}>{fmtFecha(g.fecha)}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{hhmm(g.hora_inicio)}–{hhmm(g.hora_fin)}</td>
                          <td><TipoBadge tipo={g.tipo} /></td>
                          <td style={{ color: '#c8d0dc' }}>{g.clases_profesores?.nombre || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Modal Abrir / Crear primer corte */}
      {showAbrir && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAbrir(false)}>
          <div className="modal" style={{ width: 460, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">{cortes.length === 0 ? 'Crear primer corte' : 'Abrir nuevo corte'}</div>
              <button className="btn btn-sm" onClick={() => setShowAbrir(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group full"><label>Fecha de inicio</label><input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} /></div>
              {cortes.length === 0 && huerfanas.length > 0 && (
                <div className="form-group full">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                    <input type="checkbox" checked={incluirHuerfanas} onChange={e => setIncluirHuerfanas(e.target.checked)} />
                    Hay {huerfanas.length} clase{huerfanas.length === 1 ? '' : 's'} ya marcada{huerfanas.length === 1 ? '' : 's'} como realizada{huerfanas.length === 1 ? '' : 's'} sin corte asignado. ¿Incluirlas en este corte?
                  </label>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowAbrir(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleAbrir} disabled={guardando || !fechaInicio}>
                {guardando ? <><i className="ti ti-loader"></i> Abriendo…</> : <><i className="ti ti-check"></i> {cortes.length === 0 ? 'Crear corte' : 'Abrir corte'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cerrar corte */}
      {showCerrar && corte && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCerrar(false)}>
          <div className="modal" style={{ width: 460, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">Cerrar corte #{corte.numero}</div>
              <button className="btn btn-sm" onClick={() => setShowCerrar(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group full"><label>Fecha de fin</label><input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} /></div>
            </div>
            <div style={{ padding: '0 1rem 0.5rem', fontSize: 13, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
              Se congelará la tarifa actual (<strong>{formatearMontoConSimbolo(config.tarifa_hora_profesor || 0)}</strong>/h).<br />
              Cálculo: <strong>{fmtHoras(horas)}</strong> h-prof × {formatearMontoConSimbolo(config.tarifa_hora_profesor || 0)} = <strong style={{ color: '#5dcaa5' }}>{formatearMontoConSimbolo(Math.round(horas * (config.tarifa_hora_profesor || 0)))}</strong>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowCerrar(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCerrar} disabled={guardando}>
                {guardando ? <><i className="ti ti-loader"></i> Cerrando…</> : <><i className="ti ti-lock"></i> Cerrar corte</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar ajuste */}
      {showAjuste && corte && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAjuste(false)}>
          <div className="modal" style={{ width: 460, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">Editar ajuste — Corte #{corte.numero}</div>
              <button className="btn btn-sm" onClick={() => setShowAjuste(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group full"><label>Ajuste (CLP, puede ser negativo)</label>
                <input inputMode="numeric" placeholder="Ej: -5000 o 10000" value={ajusteText} onChange={e => setAjusteText(e.target.value)} />
              </div>
              <div className="form-group full"><label>Comentario {parseAjuste(ajusteText) !== 0 && <span style={{ color: '#f09595' }}>*</span>}</label>
                <textarea rows={2} placeholder="Motivo del ajuste" value={comentarioAjuste} onChange={e => setComentarioAjuste(e.target.value)} />
              </div>
            </div>
            <div style={{ padding: '0 1rem 0.5rem', fontSize: 13, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
              Monto calculado: {formatearMontoConSimbolo(montoCalc)} → <strong style={{ color: '#5dcaa5' }}>monto final: {formatearMontoConSimbolo(ajustePreview)}</strong>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowAjuste(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleAjuste} disabled={guardando}>
                {guardando ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Guardar ajuste</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Marcar pagado */}
      {showPagar && corte && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowPagar(false)}>
          <div className="modal" style={{ width: 460, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">Marcar como pagado — Corte #{corte.numero}</div>
              <button className="btn btn-sm" onClick={() => setShowPagar(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group full"><label>Referencia de pago *</label>
                <input placeholder="Ej: Cheque N°1234 Banco Estado" value={refPago} onChange={e => setRefPago(e.target.value)} />
              </div>
              <div className="form-group full"><label>Comentario (opcional)</label>
                <textarea rows={2} value={comentarioPago} onChange={e => setComentarioPago(e.target.value)} />
              </div>
            </div>
            <div style={{ padding: '0 1rem 0.5rem', fontSize: 13, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
              Monto a pagar: <strong style={{ color: '#5dcaa5' }}>{formatearMontoConSimbolo(corte.monto_final || 0)}</strong>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowPagar(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handlePagar} disabled={guardando}>
                {guardando ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-cash"></i> Marcar pagado</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
