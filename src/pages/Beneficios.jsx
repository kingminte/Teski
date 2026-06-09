import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'

const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const addDias = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}` }
const fmtFecha = (iso) => iso ? iso.split('-').reverse().join('/') : ''
const iniciales = (nombre) => {
  const p = (nombre || '').trim().split(/\s+/)
  if (!p[0]) return '?'
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[1][0]).toUpperCase()
}

// Paleta determinística por nombre de categoría
const PALETA = [
  { bg: 'rgba(163,45,45,0.15)', color: '#f09595' },
  { bg: 'rgba(239,159,39,0.15)', color: '#fac775' },
  { bg: 'rgba(55,138,221,0.15)', color: '#85b7eb' },
  { bg: 'rgba(29,158,117,0.15)', color: '#5dcaa5' },
  { bg: 'rgba(175,169,236,0.15)', color: '#afa9ec' },
  { bg: 'rgba(127,140,158,0.15)', color: '#9aa6b8' },
]
const colorCat = (nombre) => {
  let h = 0
  for (const c of (nombre || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETA[h % PALETA.length]
}

// Estado calculado del beneficio
const estadoDe = (b) => {
  const hoy = hoyISO()
  if (b.archivado) return 'archivado'
  if (!b.activo) return 'pausado'
  if (b.vigencia_hasta < hoy) return 'vencido'
  if (b.vigencia_desde > hoy) return 'futuro'
  if (b.vigencia_hasta <= addDias(hoy, 30)) return 'proximo'
  return 'vigente'
}
const ESTADO_META = {
  vigente: { bg: 'rgba(29,158,117,0.15)', color: '#5dcaa5', txt: 'Vigente' },
  proximo: { bg: 'rgba(239,159,39,0.15)', color: '#fac775', txt: 'Próximo a vencer' },
  futuro: { bg: 'rgba(55,138,221,0.15)', color: '#85b7eb', txt: 'Futuro' },
  vencido: { bg: 'rgba(127,140,158,0.15)', color: '#9aa6b8', txt: 'Vencido' },
  pausado: { bg: 'rgba(239,159,39,0.12)', color: '#fac775', txt: 'Pausado' },
  archivado: { bg: 'rgba(127,140,158,0.15)', color: '#9aa6b8', txt: 'Archivado' },
}
const EMPTY_BENEF = { titulo: '', proveedor: '', categoria_id: '', descuento_texto: '', descripcion: '', contacto: '', url: '', vigencia_desde: '', vigencia_hasta: '', activo: true }

const FILTROS_ADMIN = [
  { id: 'todos', label: 'Todos' },
  { id: 'vigente', label: 'Vigentes' },
  { id: 'proximo', label: 'Próximos a vencer' },
  { id: 'vencido', label: 'Vencidos' },
  { id: 'pausado', label: 'Pausados' },
  { id: 'archivado', label: 'Archivados' },
]

export default function Beneficios() {
  const { showToast, ToastComponent } = useToast()
  const { user, puedeEditar } = useAuth()
  const editable = puedeEditar('beneficios')      // admin/gestor (completo)
  const modoSocio = user?.rol === 'socio'         // socio → cards; el resto → vista admin (lector sin botones)

  const [beneficios, setBeneficios] = useState([])
  const [categorias, setCategorias] = useState([])
  const [loading, setLoading] = useState(true)

  const [filtroCat, setFiltroCat] = useState('todas')   // socio
  const [filtroEstado, setFiltroEstado] = useState('todos') // admin

  // Modal beneficio
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_BENEF)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)

  // Modal categorías
  const [showCats, setShowCats] = useState(false)
  const [formCat, setFormCat] = useState({ nombre: '', orden: 0, activo: true })
  const [editCatId, setEditCatId] = useState(null)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    const [{ data: cats }, { data: bens }] = await Promise.all([
      supabase.from('beneficios_categorias').select('*').order('orden'),
      supabase.from('beneficios').select('*').order('vigencia_hasta', { ascending: false }),
    ])
    setCategorias(cats || [])
    setBeneficios(bens || [])
    setLoading(false)
  }

  const catNombre = (id) => categorias.find(c => c.id === id)?.nombre || 'Sin categoría'
  const catActivas = categorias.filter(c => c.activo)

  // ----- CRUD beneficio -----
  const openNew = () => {
    setForm({ ...EMPTY_BENEF, vigencia_desde: hoyISO() })
    setEditId(null); setShowModal(true)
  }
  const openEdit = (b) => {
    setForm({
      titulo: b.titulo, proveedor: b.proveedor, categoria_id: b.categoria_id || '', descuento_texto: b.descuento_texto,
      descripcion: b.descripcion || '', contacto: b.contacto || '', url: b.url || '',
      vigencia_desde: b.vigencia_desde, vigencia_hasta: b.vigencia_hasta, activo: b.activo,
    })
    setEditId(b.id); setShowModal(true)
  }
  const handleSave = async () => {
    if (!form.titulo.trim() || !form.proveedor.trim() || !form.categoria_id || !form.descuento_texto.trim()) {
      showToast('Título, proveedor, categoría y descuento son obligatorios', 'error'); return
    }
    if (!form.vigencia_desde || !form.vigencia_hasta) { showToast('Indica el rango de vigencia', 'error'); return }
    if (form.vigencia_hasta < form.vigencia_desde) { showToast('La vigencia "hasta" no puede ser anterior a "desde"', 'error'); return }
    setSaving(true)
    const payload = { ...form, categoria_id: form.categoria_id || null }
    let error
    if (editId) {
      ;({ error } = await supabase.from('beneficios').update({ ...payload, updated_at: new Date().toISOString(), updated_by: user?.id || null }).eq('id', editId))
    } else {
      ;({ error } = await supabase.from('beneficios').insert({ ...payload, created_by: user?.id || null }))
    }
    setSaving(false)
    if (error) showToast('Error al guardar: ' + error.message, 'error')
    else { showToast(editId ? 'Beneficio actualizado' : 'Beneficio creado'); setShowModal(false); loadAll() }
  }
  const handlePausar = async (b) => {
    const { error } = await supabase.from('beneficios').update({ activo: !b.activo, updated_at: new Date().toISOString(), updated_by: user?.id || null }).eq('id', b.id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast(b.activo ? 'Beneficio pausado' : 'Beneficio reactivado'); loadAll() }
  }
  const handleArchivar = async (b) => {
    if (!confirm('¿Archivar este beneficio? No será visible para los socios pero quedará en el histórico para consulta.')) return
    const { error } = await supabase.from('beneficios').update({ archivado: true, updated_at: new Date().toISOString(), updated_by: user?.id || null }).eq('id', b.id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Beneficio archivado'); loadAll() }
  }
  const handleRestaurar = async (b) => {
    const { error } = await supabase.from('beneficios').update({ archivado: false, updated_at: new Date().toISOString(), updated_by: user?.id || null }).eq('id', b.id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Beneficio restaurado'); loadAll() }
  }

  // ----- CRUD categorías -----
  const openNewCat = () => { setFormCat({ nombre: '', orden: (categorias.reduce((m, c) => Math.max(m, c.orden), 0)) + 1, activo: true }); setEditCatId(null) }
  const handleSaveCat = async () => {
    if (!formCat.nombre.trim()) { showToast('El nombre es obligatorio', 'error'); return }
    const payload = { ...formCat, orden: parseInt(formCat.orden, 10) || 0 }
    let error
    if (editCatId) { ;({ error } = await supabase.from('beneficios_categorias').update(payload).eq('id', editCatId)) }
    else { ;({ error } = await supabase.from('beneficios_categorias').insert(payload)) }
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast(editCatId ? 'Categoría actualizada' : 'Categoría creada'); setEditCatId(null); setFormCat({ nombre: '', orden: 0, activo: true }); loadAll() }
  }
  const handleToggleCat = async (c) => { await supabase.from('beneficios_categorias').update({ activo: !c.activo }).eq('id', c.id); loadAll() }
  const handleDeleteCat = async (c) => {
    if (beneficios.some(b => b.categoria_id === c.id)) { showToast('No se puede eliminar: tiene beneficios asociados', 'error'); return }
    if (!confirm(`¿Eliminar la categoría "${c.nombre}"?`)) return
    const { error } = await supabase.from('beneficios_categorias').delete().eq('id', c.id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Categoría eliminada'); loadAll() }
  }

  // ============ RENDER SOCIO ============
  if (modoSocio) {
    const visibles = beneficios.filter(b => ['vigente', 'proximo'].includes(estadoDe(b)))
    const porCat = filtroCat === 'todas' ? visibles : visibles.filter(b => b.categoria_id === filtroCat)
    const conteoCat = (id) => visibles.filter(b => b.categoria_id === id).length
    const anio = new Date().getFullYear()
    return (
      <div>
        {ToastComponent}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><i className="ti ti-gift"></i> Beneficios y Convenios — Teski Club {anio}</div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{visibles.length} vigente{visibles.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        {loading ? (
          <div className="card"><div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div></div>
        ) : visibles.length === 0 ? (
          <div className="card"><div className="empty-state"><i className="ti ti-gift-off"></i>Por el momento no hay beneficios vigentes. Vuelve pronto.</div></div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' }}>
              <button onClick={() => setFiltroCat('todas')} className="chip" style={{ cursor: 'pointer', borderColor: filtroCat === 'todas' ? 'var(--gold)' : undefined, color: filtroCat === 'todas' ? 'var(--gold-light)' : undefined }}>Todas · {visibles.length}</button>
              {catActivas.filter(c => conteoCat(c.id) > 0).map(c => (
                <button key={c.id} onClick={() => setFiltroCat(c.id)} className="chip" style={{ cursor: 'pointer', borderColor: filtroCat === c.id ? 'var(--gold)' : undefined, color: filtroCat === c.id ? 'var(--gold-light)' : undefined }}>
                  {c.nombre} · {conteoCat(c.id)}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>
              {porCat.map(b => {
                const col = colorCat(catNombre(b.categoria_id))
                return (
                  <div key={b.id} className="card" style={{ padding: '1rem 1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ display: 'flex', gap: 12, minWidth: 0 }}>
                        <div style={{ width: 42, height: 42, borderRadius: '50%', background: col.bg, color: col.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 'bold', flexShrink: 0 }}>
                          {iniciales(b.proveedor)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 15, color: '#c8d0dc', fontWeight: 600 }}>{b.proveedor}</div>
                          <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 7px', borderRadius: 4, background: col.bg, color: col.color }}>{catNombre(b.categoria_id)}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 'bold', color: '#5dcaa5', textAlign: 'right', flexShrink: 0 }}>{b.descuento_texto}</div>
                    </div>
                    <div style={{ fontSize: 13, color: '#c8d0dc', marginTop: 10, fontWeight: 500 }}>{b.titulo}</div>
                    {b.descripcion && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginTop: 4 }}>{b.descripcion}</div>}
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span><i className="ti ti-calendar"></i> Hasta {fmtFecha(b.vigencia_hasta)}</span>
                      {b.contacto && <span><i className="ti ti-phone"></i> {b.contacto}</span>}
                      {b.url && <a href={b.url} target="_blank" rel="noreferrer" style={{ color: '#85b7eb' }}><i className="ti ti-external-link"></i> Sitio</a>}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    )
  }

  // ============ RENDER ADMIN / LECTOR ============
  const filtrados = filtroEstado === 'todos' ? beneficios : beneficios.filter(b => estadoDe(b) === filtroEstado)
  return (
    <div>
      {ToastComponent}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-gift"></i> Beneficios y Convenios</div>
          {editable && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" onClick={() => { openNewCat(); setShowCats(true) }}><i className="ti ti-tags"></i> Gestionar categorías</button>
              <button className="btn btn-primary btn-sm" onClick={openNew}><i className="ti ti-plus"></i> Nuevo beneficio</button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 1.5rem 1rem' }}>
          {FILTROS_ADMIN.map(f => (
            <button key={f.id} className={`btn btn-sm${filtroEstado === f.id ? ' btn-primary' : ''}`} onClick={() => setFiltroEstado(f.id)}>{f.label}</button>
          ))}
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
        ) : filtrados.length === 0 ? (
          <div className="empty-state"><i className="ti ti-gift-off"></i>Sin beneficios en este filtro.</div>
        ) : (
          <table>
            <thead><tr><th>Beneficio</th><th>Categoría</th><th>Vigencia</th><th>Estado</th>{editable && <th>Acciones</th>}</tr></thead>
            <tbody>
              {filtrados.map(b => {
                const est = estadoDe(b)
                const meta = ESTADO_META[est]
                const venColor = est === 'vigente' ? '#5dcaa5' : est === 'proximo' ? '#fac775' : 'var(--text-muted)'
                return (
                  <tr key={b.id}>
                    <td>
                      <div style={{ color: '#c8d0dc', fontWeight: 500 }}>{b.titulo}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>{b.proveedor} · {b.descuento_texto}</div>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{catNombre(b.categoria_id)}</td>
                    <td style={{ color: venColor, fontSize: 12 }}>{fmtFecha(b.vigencia_desde)} – {fmtFecha(b.vigencia_hasta)}</td>
                    <td><span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: meta.bg, color: meta.color }}>{meta.txt}</span></td>
                    {editable && (
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {!b.archivado && <button className="btn btn-sm" onClick={() => openEdit(b)} title="Editar"><i className="ti ti-edit"></i></button>}
                          {!b.archivado && <button className="btn btn-sm" onClick={() => handlePausar(b)} title={b.activo ? 'Pausar' : 'Reactivar'}><i className={`ti ${b.activo ? 'ti-player-pause' : 'ti-player-play'}`}></i></button>}
                          {!b.archivado
                            ? <button className="btn btn-sm btn-danger" onClick={() => handleArchivar(b)} title="Archivar"><i className="ti ti-archive"></i></button>
                            : <button className="btn btn-sm" onClick={() => handleRestaurar(b)} title="Restaurar"><i className="ti ti-arrow-back-up"></i> Restaurar</button>}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal Nuevo/Editar beneficio */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ width: 560, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">{editId ? 'Editar beneficio' : 'Nuevo beneficio'}</div>
              <button className="btn btn-sm" onClick={() => setShowModal(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Título *</label><input placeholder="Ej: 15% en Andacor Tienda" value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} /></div>
              <div className="form-group"><label>Proveedor *</label><input placeholder="Ej: Andacor Tienda" value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))} /></div>
              <div className="form-group"><label>Categoría *</label>
                <select value={form.categoria_id} onChange={e => setForm(f => ({ ...f, categoria_id: e.target.value }))}>
                  <option value="">Seleccionar…</option>
                  {catActivas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="form-group"><label>Descuento / valor *</label><input placeholder="Ej: 15%, 2x1, Tarifa preferencial" value={form.descuento_texto} onChange={e => setForm(f => ({ ...f, descuento_texto: e.target.value }))} /></div>
              <div className="form-group full"><label>Descripción (condiciones)</label><textarea rows={2} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} /></div>
              <div className="form-group"><label>Contacto</label><input placeholder="Teléfono, email, dirección" value={form.contacto} onChange={e => setForm(f => ({ ...f, contacto: e.target.value }))} /></div>
              <div className="form-group"><label>URL</label><input placeholder="https://…" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} /></div>
              <div className="form-group"><label>Vigencia desde *</label><input type="date" value={form.vigencia_desde} onChange={e => setForm(f => ({ ...f, vigencia_desde: e.target.value }))} /></div>
              <div className="form-group"><label>Vigencia hasta *</label><input type="date" value={form.vigencia_hasta} onChange={e => setForm(f => ({ ...f, vigencia_hasta: e.target.value }))} /></div>
              <div className="form-group full"><label>Estado</label>
                <select value={form.activo ? 'activo' : 'pausado'} onChange={e => setForm(f => ({ ...f, activo: e.target.value === 'activo' }))}>
                  <option value="activo">Activo</option><option value="pausado">Pausado</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editId ? 'Guardar cambios' : 'Crear beneficio'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Gestionar categorías */}
      {showCats && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCats(false)}>
          <div className="modal" style={{ width: 480, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">Categorías de beneficios</div>
              <button className="btn btn-sm" onClick={() => setShowCats(false)}><i className="ti ti-x"></i></button>
            </div>
            <div style={{ padding: '0.5rem 1rem 1rem' }}>
              <table>
                <thead><tr><th>Orden</th><th>Nombre</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                  {categorias.map(c => (
                    <tr key={c.id}>
                      <td><span className="chip">{c.orden}</span></td>
                      <td style={{ color: c.activo ? '#c8d0dc' : 'var(--text-dim)' }}>{c.nombre}</td>
                      <td>{c.activo ? <span className="badge badge-active">Activa</span> : <span className="badge badge-inactive">Inactiva</span>}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => { setEditCatId(c.id); setFormCat({ nombre: c.nombre, orden: c.orden, activo: c.activo }) }} title="Editar"><i className="ti ti-edit"></i></button>
                          <button className="btn btn-sm" onClick={() => handleToggleCat(c)} title={c.activo ? 'Desactivar' : 'Activar'}><i className={`ti ${c.activo ? 'ti-eye-off' : 'ti-eye'}`}></i></button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteCat(c)} title="Eliminar"><i className="ti ti-trash"></i></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 80px auto', gap: 8, alignItems: 'end' }}>
                <div className="form-group" style={{ margin: 0 }}><label>{editCatId ? 'Editar categoría' : 'Nueva categoría'}</label><input placeholder="Nombre" value={formCat.nombre} onChange={e => setFormCat(f => ({ ...f, nombre: e.target.value }))} /></div>
                <div className="form-group" style={{ margin: 0 }}><label>Orden</label><input type="number" value={formCat.orden} onChange={e => setFormCat(f => ({ ...f, orden: e.target.value }))} /></div>
                <button className="btn btn-primary btn-sm" onClick={handleSaveCat} style={{ height: 36 }}>{editCatId ? 'Guardar' : 'Agregar'}</button>
              </div>
              {editCatId && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => { setEditCatId(null); setFormCat({ nombre: '', orden: 0, activo: true }) }}>Cancelar edición</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
