import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'

const TABS = [
  { id: 'profesores', icon: 'ti-school', label: 'Profesores' },
  { id: 'niveles', icon: 'ti-stairs-up', label: 'Niveles' },
  { id: 'disponibilidad', icon: 'ti-calendar-event', label: 'Disponibilidad' },
]

const fmtFecha = (f) => f ? f.split('-').reverse().join('/') : '—'

export default function ClasesCatalogos() {
  const { showToast, ToastComponent } = useToast()
  const { puedeEditar, user } = useAuth()
  const editable = puedeEditar('clases_catalogos')
  const [tab, setTab] = useState('profesores')

  // --- Profesores ---
  const [profesores, setProfesores] = useState([])
  const [loadingProf, setLoadingProf] = useState(true)
  const [showModalProf, setShowModalProf] = useState(false)
  const [formProf, setFormProf] = useState({ nombre: '', comentario: '', activo: true })
  const [editProfId, setEditProfId] = useState(null)
  const [savingProf, setSavingProf] = useState(false)

  // --- Niveles ---
  const [niveles, setNiveles] = useState([])
  const [loadingNiv, setLoadingNiv] = useState(true)
  const [showModalNiv, setShowModalNiv] = useState(false)
  const [formNiv, setFormNiv] = useState({ nombre: '', orden: 1, activo: true })
  const [editNivId, setEditNivId] = useState(null)
  const [savingNiv, setSavingNiv] = useState(false)

  // --- Disponibilidad ---
  const [fechas, setFechas] = useState([])
  const [loadingFec, setLoadingFec] = useState(true)
  const [showModalFec, setShowModalFec] = useState(false)
  const [formFec, setFormFec] = useState({ fecha: '', notas: '' })
  const [editFecId, setEditFecId] = useState(null)
  const [savingFec, setSavingFec] = useState(false)

  useEffect(() => { loadProfesores(); loadNiveles(); loadFechas() }, [])

  // ============ Profesores ============
  const loadProfesores = async () => {
    setLoadingProf(true)
    const { data } = await supabase.from('clases_profesores').select('*').order('nombre')
    setProfesores(data || [])
    setLoadingProf(false)
  }
  const openNewProf = () => { setFormProf({ nombre: '', comentario: '', activo: true }); setEditProfId(null); setShowModalProf(true) }
  const openEditProf = (p) => { setFormProf({ nombre: p.nombre, comentario: p.comentario || '', activo: p.activo }); setEditProfId(p.id); setShowModalProf(true) }
  const handleSaveProf = async () => {
    if (!formProf.nombre.trim()) { showToast('El nombre es obligatorio', 'error'); return }
    setSavingProf(true)
    let error
    if (editProfId) { ;({ error } = await supabase.from('clases_profesores').update(formProf).eq('id', editProfId)) }
    else { ;({ error } = await supabase.from('clases_profesores').insert(formProf)) }
    setSavingProf(false)
    if (error) showToast('Error al guardar profesor: ' + error.message, 'error')
    else { showToast(editProfId ? 'Profesor actualizado' : 'Profesor agregado'); setShowModalProf(false); loadProfesores() }
  }
  const handleToggleProf = async (id, activo) => { await supabase.from('clases_profesores').update({ activo: !activo }).eq('id', id); loadProfesores() }
  const handleDeleteProf = async (id) => {
    if (!confirm('¿Eliminar este profesor?')) return
    const { error } = await supabase.from('clases_profesores').delete().eq('id', id)
    if (error) showToast('No se puede eliminar (puede tener clases asociadas)', 'error')
    else { showToast('Profesor eliminado'); loadProfesores() }
  }

  // ============ Niveles ============
  const loadNiveles = async () => {
    setLoadingNiv(true)
    const { data } = await supabase.from('clases_niveles').select('*').order('orden')
    setNiveles(data || [])
    setLoadingNiv(false)
  }
  const openNewNiv = () => {
    const maxOrden = niveles.reduce((m, n) => Math.max(m, n.orden), 0)
    setFormNiv({ nombre: '', orden: maxOrden + 1, activo: true }); setEditNivId(null); setShowModalNiv(true)
  }
  const openEditNiv = (n) => { setFormNiv({ nombre: n.nombre, orden: n.orden, activo: n.activo }); setEditNivId(n.id); setShowModalNiv(true) }
  const handleSaveNiv = async () => {
    if (!formNiv.nombre.trim()) { showToast('El nombre es obligatorio', 'error'); return }
    setSavingNiv(true)
    const payload = { ...formNiv, orden: parseInt(formNiv.orden, 10) || 0 }
    let error
    if (editNivId) { ;({ error } = await supabase.from('clases_niveles').update(payload).eq('id', editNivId)) }
    else { ;({ error } = await supabase.from('clases_niveles').insert(payload)) }
    setSavingNiv(false)
    if (error) showToast('Error al guardar nivel: ' + error.message, 'error')
    else { showToast(editNivId ? 'Nivel actualizado' : 'Nivel agregado'); setShowModalNiv(false); loadNiveles() }
  }
  const handleToggleNiv = async (id, activo) => { await supabase.from('clases_niveles').update({ activo: !activo }).eq('id', id); loadNiveles() }
  const handleOrdenNiv = async (id, orden) => {
    const n = parseInt(orden, 10)
    if (isNaN(n)) return
    await supabase.from('clases_niveles').update({ orden: n }).eq('id', id)
    loadNiveles()
  }
  const handleDeleteNiv = async (id) => {
    if (!confirm('¿Eliminar este nivel?')) return
    const { error } = await supabase.from('clases_niveles').delete().eq('id', id)
    if (error) showToast('No se puede eliminar (puede estar en uso)', 'error')
    else { showToast('Nivel eliminado'); loadNiveles() }
  }

  // ============ Disponibilidad ============
  const loadFechas = async () => {
    setLoadingFec(true)
    const { data } = await supabase.from('clases_disponibilidad').select('*').order('fecha', { ascending: true })
    setFechas(data || [])
    setLoadingFec(false)
  }
  const openNewFec = () => { setFormFec({ fecha: '', notas: '' }); setEditFecId(null); setShowModalFec(true) }
  const openEditFec = (f) => { setFormFec({ fecha: f.fecha, notas: f.notas || '' }); setEditFecId(f.id); setShowModalFec(true) }
  const handleSaveFec = async () => {
    if (!formFec.fecha) { showToast('La fecha es obligatoria', 'error'); return }
    setSavingFec(true)
    let error
    if (editFecId) {
      ;({ error } = await supabase.from('clases_disponibilidad').update({ fecha: formFec.fecha, notas: formFec.notas || null }).eq('id', editFecId))
    } else {
      ;({ error } = await supabase.from('clases_disponibilidad').insert({ fecha: formFec.fecha, notas: formFec.notas || null, created_by: user?.id || null }))
    }
    setSavingFec(false)
    if (error) {
      const dup = error.code === '23505' || error.message?.includes('unique')
      showToast(dup ? 'Ya existe una fecha de disponibilidad para ese día' : 'Error al guardar: ' + error.message, 'error')
    } else { showToast(editFecId ? 'Fecha actualizada' : 'Fecha agregada'); setShowModalFec(false); loadFechas() }
  }
  const handleDeleteFec = async (id) => {
    if (!confirm('¿Eliminar esta fecha de disponibilidad?')) return
    const { error } = await supabase.from('clases_disponibilidad').delete().eq('id', id)
    if (error) showToast('Error al eliminar: ' + error.message, 'error')
    else { showToast('Fecha eliminada'); loadFechas() }
  }

  return (
    <div>
      {ToastComponent}

      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', marginBottom: '1.5rem' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 20px', fontSize: 13, border: 'none', background: 'transparent',
            color: tab === t.id ? 'var(--gold)' : 'var(--text-muted)',
            borderBottom: `2px solid ${tab === t.id ? 'var(--gold)' : 'transparent'}`,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'sans-serif', fontWeight: tab === t.id ? 'bold' : 'normal',
          }}>
            <i className={`ti ${t.icon}`}></i> {t.label}
          </button>
        ))}
      </div>

      {/* ============ TAB PROFESORES ============ */}
      {tab === 'profesores' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><i className="ti ti-school"></i> Profesores</div>
            {editable && <button className="btn btn-primary btn-sm" onClick={openNewProf}><i className="ti ti-plus"></i> Nuevo profesor</button>}
          </div>
          {loadingProf ? (
            <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
          ) : profesores.length === 0 ? (
            <div className="empty-state"><i className="ti ti-school"></i>No hay profesores registrados.</div>
          ) : (
            <table>
              <thead><tr><th>Nombre</th><th>Comentario</th><th>Estado</th>{editable && <th>Acciones</th>}</tr></thead>
              <tbody>
                {profesores.map(p => (
                  <tr key={p.id}>
                    <td style={{ color: p.activo ? '#c8d0dc' : 'var(--text-dim)' }}>{p.nombre}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.comentario || '—'}</td>
                    <td>{p.activo ? <span className="badge badge-active">Activo</span> : <span className="badge badge-inactive">Inactivo</span>}</td>
                    {editable && (
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => openEditProf(p)} title="Editar"><i className="ti ti-edit"></i></button>
                          <button className="btn btn-sm" onClick={() => handleToggleProf(p.id, p.activo)} title={p.activo ? 'Desactivar' : 'Activar'}>
                            <i className={`ti ${p.activo ? 'ti-eye-off' : 'ti-eye'}`}></i>
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteProf(p.id)} title="Eliminar"><i className="ti ti-trash"></i></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ============ TAB NIVELES ============ */}
      {tab === 'niveles' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><i className="ti ti-stairs-up"></i> Niveles</div>
            {editable && <button className="btn btn-primary btn-sm" onClick={openNewNiv}><i className="ti ti-plus"></i> Nuevo nivel</button>}
          </div>
          {loadingNiv ? (
            <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
          ) : niveles.length === 0 ? (
            <div className="empty-state"><i className="ti ti-stairs-up"></i>No hay niveles registrados.</div>
          ) : (
            <table>
              <thead><tr><th style={{ width: 90 }}>Orden</th><th>Nombre</th><th>Estado</th>{editable && <th>Acciones</th>}</tr></thead>
              <tbody>
                {niveles.map(n => (
                  <tr key={n.id}>
                    <td>
                      {editable ? (
                        <input type="number" defaultValue={n.orden} onBlur={e => { if (parseInt(e.target.value, 10) !== n.orden) handleOrdenNiv(n.id, e.target.value) }}
                          style={{ width: 60, padding: '3px 6px', fontSize: 13 }} title="Editar orden" />
                      ) : <span className="chip">{n.orden}</span>}
                    </td>
                    <td style={{ color: n.activo ? '#c8d0dc' : 'var(--text-dim)' }}>{n.nombre}</td>
                    <td>{n.activo ? <span className="badge badge-active">Activo</span> : <span className="badge badge-inactive">Inactivo</span>}</td>
                    {editable && (
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => openEditNiv(n)} title="Editar"><i className="ti ti-edit"></i></button>
                          <button className="btn btn-sm" onClick={() => handleToggleNiv(n.id, n.activo)} title={n.activo ? 'Desactivar' : 'Activar'}>
                            <i className={`ti ${n.activo ? 'ti-eye-off' : 'ti-eye'}`}></i>
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteNiv(n.id)} title="Eliminar"><i className="ti ti-trash"></i></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ============ TAB DISPONIBILIDAD ============ */}
      {tab === 'disponibilidad' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><i className="ti ti-calendar-event"></i> Disponibilidad de clases</div>
            {editable && <button className="btn btn-primary btn-sm" onClick={openNewFec}><i className="ti ti-plus"></i> Agregar fecha</button>}
          </div>
          {loadingFec ? (
            <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
          ) : fechas.length === 0 ? (
            <div className="empty-state"><i className="ti ti-calendar-off"></i>No hay fechas de disponibilidad publicadas.</div>
          ) : (
            <table>
              <thead><tr><th>Fecha</th><th>Notas</th>{editable && <th>Acciones</th>}</tr></thead>
              <tbody>
                {fechas.map(f => (
                  <tr key={f.id}>
                    <td style={{ color: '#c8d0dc' }}><i className="ti ti-calendar" style={{ color: 'var(--gold-dim)', fontSize: 15, marginRight: 8 }}></i>{fmtFecha(f.fecha)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{f.notas || '—'}</td>
                    {editable && (
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => openEditFec(f)} title="Editar"><i className="ti ti-edit"></i></button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteFec(f.id)} title="Eliminar"><i className="ti ti-trash"></i></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ============ MODALES ============ */}
      {showModalProf && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModalProf(false)}>
          <div className="modal" style={{ width: 420 }}>
            <div className="modal-header">
              <div className="modal-title">{editProfId ? 'Editar profesor' : 'Nuevo profesor'}</div>
              <button className="btn btn-sm" onClick={() => setShowModalProf(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group full"><label>Nombre *</label>
                <input placeholder="Ej: Juan Pérez" value={formProf.nombre} onChange={e => setFormProf(f => ({ ...f, nombre: e.target.value }))} />
              </div>
              <div className="form-group full"><label>Comentario (opcional)</label>
                <input placeholder="Notas" value={formProf.comentario} onChange={e => setFormProf(f => ({ ...f, comentario: e.target.value }))} />
              </div>
              <div className="form-group full"><label>Estado</label>
                <select value={formProf.activo ? 'activo' : 'inactivo'} onChange={e => setFormProf(f => ({ ...f, activo: e.target.value === 'activo' }))}>
                  <option value="activo">Activo</option><option value="inactivo">Inactivo</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModalProf(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSaveProf} disabled={savingProf}>
                {savingProf ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editProfId ? 'Guardar cambios' : 'Agregar profesor'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModalNiv && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModalNiv(false)}>
          <div className="modal" style={{ width: 420 }}>
            <div className="modal-header">
              <div className="modal-title">{editNivId ? 'Editar nivel' : 'Nuevo nivel'}</div>
              <button className="btn btn-sm" onClick={() => setShowModalNiv(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group full"><label>Nombre *</label>
                <input placeholder="Ej: Intermedio" value={formNiv.nombre} onChange={e => setFormNiv(f => ({ ...f, nombre: e.target.value }))} />
              </div>
              <div className="form-group full"><label>Orden</label>
                <input type="number" value={formNiv.orden} onChange={e => setFormNiv(f => ({ ...f, orden: e.target.value }))} />
              </div>
              <div className="form-group full"><label>Estado</label>
                <select value={formNiv.activo ? 'activo' : 'inactivo'} onChange={e => setFormNiv(f => ({ ...f, activo: e.target.value === 'activo' }))}>
                  <option value="activo">Activo</option><option value="inactivo">Inactivo</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModalNiv(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSaveNiv} disabled={savingNiv}>
                {savingNiv ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editNivId ? 'Guardar cambios' : 'Agregar nivel'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModalFec && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModalFec(false)}>
          <div className="modal" style={{ width: 420 }}>
            <div className="modal-header">
              <div className="modal-title">{editFecId ? 'Editar fecha' : 'Agregar fecha'}</div>
              <button className="btn btn-sm" onClick={() => setShowModalFec(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group full"><label>Fecha *</label>
                <input type="date" value={formFec.fecha} onChange={e => setFormFec(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div className="form-group full"><label>Notas (opcional)</label>
                <input placeholder="Ej: solo mañana, pista principal…" value={formFec.notas} onChange={e => setFormFec(f => ({ ...f, notas: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModalFec(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSaveFec} disabled={savingFec}>
                {savingFec ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editFecId ? 'Guardar cambios' : 'Agregar fecha'}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
