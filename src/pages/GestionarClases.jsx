import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const fmtDiaFecha = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${DIAS[dt.getDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}
const hhmm = (t) => (t || '').slice(0, 5)

const TipoBadge = ({ tipo }) => (
  <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 7px', borderRadius: 4, background: tipo === 'snowboard' ? 'rgba(175,169,236,0.15)' : 'rgba(55,138,221,0.15)', color: tipo === 'snowboard' ? '#afa9ec' : '#85b7eb' }}>
    {tipo === 'snowboard' ? 'Snowboard' : 'Esquí'}
  </span>
)

const EMPTY_GRUPO = { hora_inicio: '10:00', hora_fin: '12:00', profesor_id: '', comentario: '' }

export default function GestionarClases() {
  const { showToast, ToastComponent } = useToast()
  const { puedeEditar } = useAuth()
  const editable = puedeEditar('clases_gestion')

  const [disponibilidad, setDisponibilidad] = useState([])
  const [fechaSel, setFechaSel] = useState('')
  const [profesores, setProfesores] = useState([])
  const [niveles, setNiveles] = useState([])
  const [solicitudes, setSolicitudes] = useState([])   // de la fecha, enriquecidas
  const [grupos, setGrupos] = useState([])              // de la fecha, con profesor
  const [loading, setLoading] = useState(true)

  // Agrupar
  const [agruparSol, setAgruparSol] = useState(null)
  const [agruparModo, setAgruparModo] = useState('nuevo')
  const [agruparGrupoId, setAgruparGrupoId] = useState('')
  const [nuevoGrupo, setNuevoGrupo] = useState(EMPTY_GRUPO)
  const [guardandoAgrupar, setGuardandoAgrupar] = useState(false)

  // Editar grupo
  const [editGrupo, setEditGrupo] = useState(null)
  const [formEdit, setFormEdit] = useState(EMPTY_GRUPO)
  const [guardandoEdit, setGuardandoEdit] = useState(false)

  const nivelNombre = (id) => niveles.find(n => n.id === id)?.nombre || '—'

  useEffect(() => { loadBase() }, [])
  useEffect(() => { if (fechaSel) loadFecha(fechaSel) }, [fechaSel])

  const loadBase = async () => {
    const [{ data: disp }, { data: profs }, { data: nivs }] = await Promise.all([
      supabase.from('clases_disponibilidad').select('*').order('fecha'),
      supabase.from('clases_profesores').select('*').eq('activo', true).order('nombre'),
      supabase.from('clases_niveles').select('*').order('orden'),
    ])
    setDisponibilidad(disp || [])
    setProfesores(profs || [])
    setNiveles(nivs || [])
    const hoy = hoyISO()
    const futura = (disp || []).find(d => d.fecha >= hoy)
    const inicial = (futura || (disp || [])[(disp || []).length - 1] || {}).fecha || ''
    setFechaSel(inicial)
    if (!inicial) setLoading(false)
  }

  const loadFecha = async (fecha) => {
    setLoading(true)
    const [{ data: sols }, { data: grps }] = await Promise.all([
      supabase.from('clases_solicitudes').select('*').eq('fecha', fecha),
      supabase.from('clases_grupos').select('*, clases_profesores(nombre)').eq('fecha', fecha).order('hora_inicio'),
    ])
    const lista = sols || []
    const nombreMap = await resolverNombres(lista)
    const enriquecidas = lista.map(s => ({
      ...s,
      participanteNombre: nombreMap[s.participante_id] || 'Participante',
      socioNombre: nombreMap[s.socio_id] || 'Socio',
    }))
    setSolicitudes(enriquecidas)
    setGrupos(grps || [])
    setLoading(false)
  }

  const resolverNombres = async (sols) => {
    const socioIds = new Set(), beneIds = new Set()
    sols.forEach(s => {
      socioIds.add(s.socio_id)
      if (s.participante_tipo === 'socio') socioIds.add(s.participante_id)
      else beneIds.add(s.participante_id)
    })
    const map = {}
    if (socioIds.size) {
      const { data } = await supabase.from('socios').select('id,nombre,apellido').in('id', [...socioIds])
      ;(data || []).forEach(s => { map[s.id] = `${s.nombre} ${s.apellido}` })
    }
    if (beneIds.size) {
      const { data } = await supabase.from('beneficiarios').select('id,nombre,apellido').in('id', [...beneIds])
      ;(data || []).forEach(b => { map[b.id] = `${b.nombre} ${b.apellido}` })
    }
    return map
  }

  // Derivados
  const pendientes = solicitudes.filter(s => !s.grupo_id && s.estado === 'pendiente')
  const rosterDe = (grupoId) => solicitudes.filter(s => s.grupo_id === grupoId && s.estado !== 'cancelada')
  const agendadas = solicitudes.filter(s => s.estado === 'agendada').length

  // ----- Agrupar -----
  const openAgrupar = (sol) => {
    const gruposMismoTipo = grupos.filter(g => g.tipo === sol.tipo)
    setAgruparSol(sol)
    setAgruparModo(gruposMismoTipo.length > 0 ? 'existente' : 'nuevo')
    setAgruparGrupoId(gruposMismoTipo[0]?.id || '')
    setNuevoGrupo(EMPTY_GRUPO)
  }
  const handleConfirmarAgrupar = async () => {
    const sol = agruparSol
    setGuardandoAgrupar(true)
    try {
      let grupoId = agruparGrupoId
      if (agruparModo === 'nuevo') {
        if (!nuevoGrupo.hora_inicio || !nuevoGrupo.hora_fin) { showToast('Indicá hora de inicio y fin', 'error'); setGuardandoAgrupar(false); return }
        const { data, error } = await supabase.from('clases_grupos').insert({
          fecha: sol.fecha, hora_inicio: nuevoGrupo.hora_inicio, hora_fin: nuevoGrupo.hora_fin,
          tipo: sol.tipo, profesor_id: nuevoGrupo.profesor_id || null, comentario: nuevoGrupo.comentario || null, estado: 'agendada',
        }).select().single()
        if (error) throw new Error(error.message)
        grupoId = data.id
      }
      if (!grupoId) { showToast('Elegí o creá un grupo', 'error'); setGuardandoAgrupar(false); return }
      const { error: e2 } = await supabase.from('clases_solicitudes').update({ grupo_id: grupoId, estado: 'agendada' }).eq('id', sol.id)
      if (e2) throw new Error(e2.message)
      showToast('Solicitud agendada')
      setAgruparSol(null)
      loadFecha(fechaSel)
    } catch (e) {
      showToast('Error al agrupar: ' + e.message, 'error')
    }
    setGuardandoAgrupar(false)
  }

  // ----- Editar / eliminar grupo -----
  const openEditGrupo = (g) => {
    setEditGrupo(g)
    setFormEdit({ hora_inicio: hhmm(g.hora_inicio), hora_fin: hhmm(g.hora_fin), profesor_id: g.profesor_id || '', comentario: g.comentario || '' })
  }
  const handleGuardarEdit = async () => {
    setGuardandoEdit(true)
    const { error } = await supabase.from('clases_grupos').update({
      hora_inicio: formEdit.hora_inicio, hora_fin: formEdit.hora_fin,
      profesor_id: formEdit.profesor_id || null, comentario: formEdit.comentario || null,
    }).eq('id', editGrupo.id)
    setGuardandoEdit(false)
    if (error) showToast('Error al guardar: ' + error.message, 'error')
    else { showToast('Grupo actualizado'); setEditGrupo(null); loadFecha(fechaSel) }
  }
  const handleEliminarGrupo = async (g) => {
    if (!confirm('¿Eliminar este grupo? Las solicitudes vuelven a "pendiente" para reagrupar.')) return
    const { error: e1 } = await supabase.from('clases_solicitudes').update({ grupo_id: null, estado: 'pendiente' }).eq('grupo_id', g.id)
    if (e1) { showToast('Error al soltar solicitudes: ' + e1.message, 'error'); return }
    const { error: e2 } = await supabase.from('clases_grupos').delete().eq('id', g.id)
    if (e2) { showToast('Error al eliminar grupo: ' + e2.message, 'error'); return }
    showToast('Grupo eliminado')
    loadFecha(fechaSel)
  }

  const gruposMismoTipo = agruparSol ? grupos.filter(g => g.tipo === agruparSol.tipo) : []

  if (disponibilidad.length === 0 && !loading) {
    return (
      <div className="card">
        <div className="empty-state"><i className="ti ti-calendar-off"></i>No hay fechas de disponibilidad publicadas. Publicá fechas en Catálogos → Disponibilidad.</div>
      </div>
    )
  }

  return (
    <div>
      {ToastComponent}

      {/* Header con selector de fecha */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-clipboard-list"></i> Gestión de clases</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Fecha:</span>
            <select value={fechaSel} onChange={e => setFechaSel(e.target.value)} style={{ width: 'auto', fontSize: 13 }}>
              {disponibilidad.map(d => <option key={d.id} value={d.fecha}>{fmtDiaFecha(d.fecha)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {!editable && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginBottom: 8 }}>
          <i className="ti ti-eye"></i> Modo solo lectura.
        </div>
      )}

      {loading ? (
        <div className="card"><div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div></div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
            {/* COLUMNA IZQUIERDA — pendientes */}
            <div className="card">
              <div className="card-header"><div className="card-title"><i className="ti ti-hourglass"></i> Solicitudes pendientes ({pendientes.length})</div></div>
              {pendientes.length === 0 ? (
                <div className="empty-state"><i className="ti ti-checks"></i>No hay solicitudes pendientes para esta fecha.</div>
              ) : (
                <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {pendientes.map(s => (
                    <div key={s.id} style={{ border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.7rem 0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, color: '#c8d0dc', fontWeight: 500 }}>{s.participanteNombre}</span>
                          <TipoBadge tipo={s.tipo} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                          {s.participante_tipo === 'beneficiario' ? `Hijo/a de ${s.socioNombre}` : 'Socio titular'} · Nivel: {nivelNombre(s.nivel_id)}
                        </div>
                      </div>
                      {editable && (
                        <button className="btn btn-sm btn-primary" style={{ flexShrink: 0 }} onClick={() => openAgrupar(s)}>
                          <i className="ti ti-plus"></i> Agrupar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* COLUMNA DERECHA — grupos */}
            <div className="card">
              <div className="card-header"><div className="card-title"><i className="ti ti-users-group"></i> Clases programadas ({grupos.length})</div></div>
              {grupos.length === 0 ? (
                <div className="empty-state"><i className="ti ti-calendar-plus"></i>Todavía no armaste clases para esta fecha.</div>
              ) : (
                <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {grupos.map(g => {
                    const roster = rosterDe(g.id)
                    const vacio = roster.length === 0
                    return (
                      <div key={g.id} style={{ border: `0.5px solid ${vacio ? 'rgba(240,149,149,0.4)' : 'var(--border)'}`, borderRadius: 8, padding: '0.8rem 0.9rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 14, color: 'var(--gold-light)', fontWeight: 600 }}><i className="ti ti-clock" style={{ fontSize: 13 }}></i> {hhmm(g.hora_inicio)}–{hhmm(g.hora_fin)}</span>
                            <TipoBadge tipo={g.tipo} />
                          </div>
                          {editable && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-sm" onClick={() => openEditGrupo(g)} title="Editar grupo"><i className="ti ti-edit"></i></button>
                              <button className="btn btn-sm btn-danger" onClick={() => handleEliminarGrupo(g)} title="Eliminar grupo"><i className="ti ti-trash"></i></button>
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginBottom: 6 }}>
                          {roster.length} estudiante{roster.length === 1 ? '' : 's'} · Profesor: {g.clases_profesores?.nombre || '— sin asignar'}
                        </div>
                        {vacio ? (
                          <div style={{ fontSize: 12, color: '#f09595', fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <i className="ti ti-alert-triangle"></i> Grupo sin participantes
                            {editable && <button className="btn btn-sm" style={{ color: '#f09595', borderColor: 'rgba(240,149,149,0.4)', fontSize: 11 }} onClick={() => handleEliminarGrupo(g)}>Eliminar</button>}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {roster.map(r => <span key={r.id} className="chip" style={{ fontSize: 11 }}>{r.participanteNombre}</span>)}
                          </div>
                        )}
                        {/* Fase 3: acá va el botón "Marcar realizada" + asistencia */}
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid rgba(201,168,76,0.08)' }}>
                          <button className="btn btn-sm" disabled title="Disponible en Fase 3" style={{ fontSize: 11, opacity: 0.5 }}>
                            <i className="ti ti-checkbox"></i> Marcar realizada (Fase 3)
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginTop: 16 }}>
            {[
              { label: 'Estudiantes hoy', value: agendadas, color: '#5dcaa5' },
              { label: 'Horas-profesor (clases)', value: grupos.length, color: 'var(--gold-light)' },
              { label: 'Pendientes', value: pendientes.length, color: '#fac775' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Modal Agrupar */}
      {agruparSol && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setAgruparSol(null)}>
          <div className="modal" style={{ width: 480, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">Agrupar: {agruparSol.participanteNombre} <TipoBadge tipo={agruparSol.tipo} /></div>
              <button className="btn btn-sm" onClick={() => setAgruparSol(null)}><i className="ti ti-x"></i></button>
            </div>
            <div style={{ padding: '0.5rem 1rem 1rem' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button onClick={() => setAgruparModo('existente')} disabled={gruposMismoTipo.length === 0}
                  style={{ flex: 1, padding: '8px', borderRadius: 8, cursor: gruposMismoTipo.length ? 'pointer' : 'not-allowed', fontFamily: 'sans-serif', fontSize: 12,
                    border: `1px solid ${agruparModo === 'existente' ? 'var(--gold)' : 'var(--border)'}`, background: agruparModo === 'existente' ? 'rgba(201,168,76,0.12)' : 'transparent',
                    color: gruposMismoTipo.length === 0 ? 'var(--text-dim)' : (agruparModo === 'existente' ? 'var(--gold-light)' : 'var(--text-muted)') }}>
                  Grupo existente ({gruposMismoTipo.length})
                </button>
                <button onClick={() => setAgruparModo('nuevo')}
                  style={{ flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer', fontFamily: 'sans-serif', fontSize: 12,
                    border: `1px solid ${agruparModo === 'nuevo' ? 'var(--gold)' : 'var(--border)'}`, background: agruparModo === 'nuevo' ? 'rgba(201,168,76,0.12)' : 'transparent',
                    color: agruparModo === 'nuevo' ? 'var(--gold-light)' : 'var(--text-muted)' }}>
                  Crear nuevo grupo
                </button>
              </div>

              {agruparModo === 'existente' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {gruposMismoTipo.map(g => (
                    <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: `0.5px solid ${agruparGrupoId === g.id ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer' }}>
                      <input type="radio" name="grupo" checked={agruparGrupoId === g.id} onChange={() => setAgruparGrupoId(g.id)} />
                      <span style={{ fontSize: 13, color: '#c8d0dc' }}>{hhmm(g.hora_inicio)}–{hhmm(g.hora_fin)}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>· {rosterDe(g.id).length} est. · {g.clases_profesores?.nombre || 'sin profesor'}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="form-grid">
                  <div className="form-group"><label>Hora inicio</label><input type="time" value={nuevoGrupo.hora_inicio} onChange={e => setNuevoGrupo(f => ({ ...f, hora_inicio: e.target.value }))} /></div>
                  <div className="form-group"><label>Hora fin</label><input type="time" value={nuevoGrupo.hora_fin} onChange={e => setNuevoGrupo(f => ({ ...f, hora_fin: e.target.value }))} /></div>
                  <div className="form-group full"><label>Profesor</label>
                    <select value={nuevoGrupo.profesor_id} onChange={e => setNuevoGrupo(f => ({ ...f, profesor_id: e.target.value }))}>
                      <option value="">— sin asignar —</option>
                      {profesores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </div>
                  <div className="form-group full"><label>Comentario (opcional)</label><input value={nuevoGrupo.comentario} onChange={e => setNuevoGrupo(f => ({ ...f, comentario: e.target.value }))} /></div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setAgruparSol(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleConfirmarAgrupar} disabled={guardandoAgrupar || (agruparModo === 'existente' && !agruparGrupoId)}>
                {guardandoAgrupar ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Agrupar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar grupo */}
      {editGrupo && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditGrupo(null)}>
          <div className="modal" style={{ width: 440, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">Editar grupo</div>
              <button className="btn btn-sm" onClick={() => setEditGrupo(null)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Hora inicio</label><input type="time" value={formEdit.hora_inicio} onChange={e => setFormEdit(f => ({ ...f, hora_inicio: e.target.value }))} /></div>
              <div className="form-group"><label>Hora fin</label><input type="time" value={formEdit.hora_fin} onChange={e => setFormEdit(f => ({ ...f, hora_fin: e.target.value }))} /></div>
              <div className="form-group full"><label>Profesor</label>
                <select value={formEdit.profesor_id} onChange={e => setFormEdit(f => ({ ...f, profesor_id: e.target.value }))}>
                  <option value="">— sin asignar —</option>
                  {profesores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div className="form-group full"><label>Comentario (opcional)</label><input value={formEdit.comentario} onChange={e => setFormEdit(f => ({ ...f, comentario: e.target.value }))} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditGrupo(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleGuardarEdit} disabled={guardandoEdit}>
                {guardandoEdit ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Guardar cambios</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
