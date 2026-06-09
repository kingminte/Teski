import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'

const BUCKET = 'archivos_directorio'
const TAMANO_MAX = 100 * 1024 * 1024
const AMBAR_BORDE = '#BA7517'

const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const fmtFecha = (iso) => iso ? iso.split('-').reverse().join('/') : ''
const addDias = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}` }
const diasHasta = (iso) => { const [y, m, d] = iso.split('-').map(Number); const h = new Date(); const hoy = new Date(h.getFullYear(), h.getMonth(), h.getDate()); return Math.round((new Date(y, m - 1, d) - hoy) / 86400000) }
const formatBytes = (b) => {
  if (b == null) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}
const sanitizar = (nombre) => (nombre || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '')
const iconoArchivo = (c) => {
  const t = `${c.archivo_tipo || ''} ${c.archivo_nombre || ''}`.toLowerCase()
  if (t.includes('pdf')) return { i: 'ti-file-type-pdf', color: '#f09595' }
  if (t.includes('word') || t.includes('.doc')) return { i: 'ti-file-type-doc', color: '#85b7eb' }
  if (t.includes('sheet') || t.includes('excel') || t.includes('.xls') || t.includes('.csv')) return { i: 'ti-file-type-xls', color: '#5dcaa5' }
  if (t.includes('presentation') || t.includes('.ppt')) return { i: 'ti-file-type-ppt', color: '#fac775' }
  return { i: 'ti-file-text', color: 'var(--text-muted)' }
}
// 'sin' | 'vencido' | 'proximo' | 'ok'
const estadoVenc = (c) => {
  if (!c.fecha_termino) return 'sin'
  const hoy = hoyISO()
  if (c.fecha_termino < hoy) return 'vencido'
  if (c.fecha_termino <= addDias(hoy, 60)) return 'proximo'
  return 'ok'
}
const EMPTY = { titulo: '', resumen: '', categoria_id: '', fecha_termino: '' }

export default function ArchivosDirectorio() {
  const { showToast, ToastComponent } = useToast()
  const { user, puedeEditar } = useAuth()
  const editable = puedeEditar('archivos_directorio')   // admin/gestor
  const esLector = !editable                            // lector (lectura)

  const [archivos, setArchivos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('vigente')
  const [filtroCat, setFiltroCat] = useState('todas')

  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [archivo, setArchivo] = useState(null)
  const [archivoExistente, setArchivoExistente] = useState(null)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [descargando, setDescargando] = useState(null)

  const [showCats, setShowCats] = useState(false)
  const [formCat, setFormCat] = useState({ nombre: '', orden: 0, activo: true })
  const [editCatId, setEditCatId] = useState(null)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    const [{ data: cats }, { data: arch }] = await Promise.all([
      supabase.from('archivos_directorio_categorias').select('*').order('orden'),
      supabase.from('archivos_directorio').select('*'),
    ])
    setCategorias(cats || [])
    setArchivos(arch || [])
    setLoading(false)
  }

  const catNombre = (id) => categorias.find(c => c.id === id)?.nombre || 'Sin categoría'
  const catActivas = categorias.filter(c => c.activo)

  // Orden: con fecha_termino primero (ASC), sin fecha al final; desempate created_at DESC
  const ordenar = (arr) => arr.slice().sort((a, b) => {
    const fa = a.fecha_termino, fb = b.fecha_termino
    if (fa && fb) { if (fa !== fb) return fa < fb ? -1 : 1 }
    else if (fa) return -1
    else if (fb) return 1
    return (b.created_at || '').localeCompare(a.created_at || '')
  })

  const estadoActual = esLector ? 'vigente' : filtroEstado
  const porEstado = archivos.filter(a => a.estado === estadoActual)
  const porCat = filtroCat === 'todas' ? porEstado : porEstado.filter(a => a.categoria_id === filtroCat)
  const lista = ordenar(porCat)
  const conteoCat = (id) => porEstado.filter(a => a.categoria_id === id).length
  const proximosVencer = archivos.filter(a => a.estado === 'vigente' && estadoVenc(a) === 'proximo').length

  // ----- Descarga -----
  const handleDescargar = async (a) => {
    if (!a.archivo_path) { showToast('Esta entrada no tiene archivo', 'error'); return }
    setDescargando(a.id)
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.archivo_path, 900, { download: a.archivo_nombre || true })
    setDescargando(null)
    if (error || !data?.signedUrl) { showToast('Error al generar el enlace de descarga', 'error'); return }
    const el = document.createElement('a'); el.href = data.signedUrl; el.download = a.archivo_nombre || ''
    document.body.appendChild(el); el.click(); el.remove()
  }

  // ----- Modal archivo -----
  const openNew = () => { setForm(EMPTY); setArchivo(null); setArchivoExistente(null); setEditId(null); setShowModal(true) }
  const openEdit = (a) => {
    setForm({ titulo: a.titulo, resumen: a.resumen || '', categoria_id: a.categoria_id || '', fecha_termino: a.fecha_termino || '' })
    setArchivo(null)
    setArchivoExistente(a.archivo_path ? { path: a.archivo_path, nombre: a.archivo_nombre } : null)
    setEditId(a.id); setShowModal(true)
  }
  const onPickArchivo = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > TAMANO_MAX) { showToast(`El archivo supera el máximo de 100 MB (${formatBytes(f.size)})`, 'error'); e.target.value = ''; return }
    setArchivo(f)
  }
  const subirArchivo = async (id, file) => {
    const path = `${id}/${Date.now()}_${sanitizar(file.name)}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file)
    if (error) return { error }
    return { cols: { archivo_path: path, archivo_nombre: file.name, archivo_tipo: file.type || null, archivo_tamano: file.size } }
  }

  const handleSave = async () => {
    if (!form.titulo.trim()) { showToast('El título es obligatorio', 'error'); return }
    if (!form.categoria_id) { showToast('La categoría es obligatoria', 'error'); return }
    if (!editId && !archivo) { showToast('Debes adjuntar un archivo', 'error'); return }

    setSaving(true)
    const base = {
      titulo: form.titulo, resumen: form.resumen || null,
      categoria_id: form.categoria_id, fecha_termino: form.fecha_termino || null,
    }
    try {
      if (editId) {
        let archivoCols = {}, pathViejo = null
        if (archivo) {
          const { error, cols } = await subirArchivo(editId, archivo)
          if (error) throw new Error('No se pudo subir el archivo: ' + error.message)
          archivoCols = cols
          if (archivoExistente?.path && archivoExistente.path !== cols.archivo_path) pathViejo = archivoExistente.path
        }
        const { error } = await supabase.from('archivos_directorio')
          .update({ ...base, ...archivoCols, updated_at: new Date().toISOString(), updated_by: user?.id || null })
          .eq('id', editId)
        if (error) throw new Error(error.message)
        if (pathViejo) await supabase.storage.from(BUCKET).remove([pathViejo])
        showToast('Archivo actualizado')
      } else {
        // Insert primero (para el id del path); si el upload falla, se borra la fila (rollback)
        const { data: ins, error: eIns } = await supabase.from('archivos_directorio')
          .insert({ ...base, estado: 'vigente', created_by: user?.id || null }).select().single()
        if (eIns) throw new Error(eIns.message)
        const id = ins.id
        const { error, cols } = await subirArchivo(id, archivo)
        if (error) {
          await supabase.from('archivos_directorio').delete().eq('id', id) // rollback
          throw new Error('No se pudo subir el archivo: ' + error.message)
        }
        const { error: eUpd } = await supabase.from('archivos_directorio').update(cols).eq('id', id)
        if (eUpd) throw new Error(eUpd.message)
        showToast('Archivo creado')
      }
      setShowModal(false); loadAll()
    } catch (e) {
      showToast('Error al guardar: ' + e.message, 'error')
    }
    setSaving(false)
  }

  const upd = async (id, patch, msg) => {
    const { error } = await supabase.from('archivos_directorio').update({ ...patch, updated_at: new Date().toISOString(), updated_by: user?.id || null }).eq('id', id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast(msg); loadAll() }
  }
  const handleArchivar = (a) => upd(a.id, { estado: 'archivado' }, 'Archivo archivado')
  const handleRestaurar = (a) => upd(a.id, { estado: 'vigente' }, 'Archivo restaurado')

  // ----- Categorías -----
  const openNewCat = () => { setFormCat({ nombre: '', orden: (categorias.reduce((m, c) => Math.max(m, c.orden), 0)) + 1, activo: true }); setEditCatId(null) }
  const handleSaveCat = async () => {
    if (!formCat.nombre.trim()) { showToast('El nombre es obligatorio', 'error'); return }
    const payload = { ...formCat, orden: parseInt(formCat.orden, 10) || 0 }
    let error
    if (editCatId) { ;({ error } = await supabase.from('archivos_directorio_categorias').update(payload).eq('id', editCatId)) }
    else { ;({ error } = await supabase.from('archivos_directorio_categorias').insert(payload)) }
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast(editCatId ? 'Categoría actualizada' : 'Categoría creada'); setEditCatId(null); setFormCat({ nombre: '', orden: 0, activo: true }); loadAll() }
  }
  const handleToggleCat = async (c) => { await supabase.from('archivos_directorio_categorias').update({ activo: !c.activo }).eq('id', c.id); loadAll() }
  const handleDeleteCat = async (c) => {
    if (archivos.some(a => a.categoria_id === c.id)) { showToast('No se puede eliminar: tiene archivos asociados', 'error'); return }
    if (!confirm(`¿Eliminar la categoría "${c.nombre}"?`)) return
    const { error } = await supabase.from('archivos_directorio_categorias').delete().eq('id', c.id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast('Categoría eliminada'); loadAll() }
  }

  // Badge de vencimiento
  const badgeVenc = (a) => {
    const e = estadoVenc(a)
    if (e === 'sin') return <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>Sin vencimiento</span>
    if (e === 'vencido') return <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(163,45,45,0.15)', color: '#f09595' }}>Vencido el {fmtFecha(a.fecha_termino)}</span>
    if (e === 'proximo') { const d = diasHasta(a.fecha_termino); return <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(239,159,39,0.15)', color: '#fac775' }}>Vence en {d} día{d === 1 ? '' : 's'}</span> }
    return <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>Vence {fmtFecha(a.fecha_termino)}</span>
  }
  const bordeIzq = (a) => {
    const e = estadoVenc(a)
    if (e === 'vencido') return '#f09595'
    if (e === 'proximo') return AMBAR_BORDE
    return 'transparent'
  }

  return (
    <div>
      {ToastComponent}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-folder"></i> Archivos Directorio <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', fontWeight: 'normal' }}>— uso interno</span></div>
          {editable && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" onClick={() => { openNewCat(); setShowCats(true) }}><i className="ti ti-tags"></i> Categorías</button>
              <button className="btn btn-primary btn-sm" onClick={openNew}><i className="ti ti-plus"></i> Nuevo archivo</button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 1.5rem 1rem' }}>
          {editable && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[{ id: 'vigente', label: `Vigentes · ${archivos.filter(a => a.estado === 'vigente').length}` }, { id: 'archivado', label: `Archivados · ${archivos.filter(a => a.estado === 'archivado').length}` }].map(f => (
                <button key={f.id} className={`btn btn-sm${filtroEstado === f.id ? ' btn-primary' : ''}`} onClick={() => setFiltroEstado(f.id)}>{f.label}</button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => setFiltroCat('todas')} className="chip" style={{ cursor: 'pointer', borderColor: filtroCat === 'todas' ? 'var(--gold)' : undefined, color: filtroCat === 'todas' ? 'var(--gold-light)' : undefined }}>Todas · {porEstado.length}</button>
            {catActivas.map(c => (
              <button key={c.id} onClick={() => setFiltroCat(c.id)} className="chip" style={{ cursor: 'pointer', borderColor: filtroCat === c.id ? 'var(--gold)' : undefined, color: filtroCat === c.id ? 'var(--gold-light)' : undefined }}>{c.nombre} · {conteoCat(c.id)}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Banner próximos a vencer */}
      {proximosVencer > 0 && (
        <div style={{ padding: '0.7rem 0.9rem', borderRadius: 8, fontSize: 12, fontFamily: 'sans-serif', marginBottom: '1rem', background: 'rgba(239,159,39,0.1)', border: '0.5px solid rgba(239,159,39,0.3)', color: '#fac775' }}>
          <i className="ti ti-alert-triangle"></i> {proximosVencer} archivo{proximosVencer === 1 ? '' : 's'} vence{proximosVencer === 1 ? '' : 'n'} en menos de 60 días.
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
        ) : lista.length === 0 ? (
          <div className="empty-state"><i className="ti ti-folder-off"></i>Sin archivos en este filtro.</div>
        ) : (
          lista.map(a => {
            const ic = iconoArchivo(a)
            return (
              <div key={a.id} style={{ display: 'flex', gap: 14, padding: '1rem 1.5rem', borderBottom: '0.5px solid rgba(201,168,76,0.08)', borderLeft: `2px solid ${bordeIzq(a)}`, alignItems: 'flex-start', opacity: a.estado === 'archivado' ? 0.7 : 1 }}>
                <i className={`ti ${ic.i}`} style={{ fontSize: 28, color: ic.color, flexShrink: 0 }}></i>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, color: '#c8d0dc', fontWeight: 600 }}>{a.titulo}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(55,138,221,0.15)', color: '#85b7eb' }}>{catNombre(a.categoria_id)}</span>
                    {badgeVenc(a)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', margin: '3px 0' }}>
                    Subido {fmtFecha((a.created_at || '').slice(0, 10))}{a.archivo_tamano ? ` · ${formatBytes(a.archivo_tamano)}` : ''} · {a.fecha_termino ? `Vence ${fmtFecha(a.fecha_termino)}` : 'Sin vencimiento'}
                  </div>
                  {a.resumen && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{a.resumen}</div>}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
                  {a.archivo_path && <button className="btn btn-sm" disabled={descargando === a.id} onClick={() => handleDescargar(a)} title="Descargar"><i className="ti ti-download"></i></button>}
                  {editable && a.estado === 'vigente' && <button className="btn btn-sm" onClick={() => openEdit(a)} title="Editar"><i className="ti ti-edit"></i></button>}
                  {editable && a.estado === 'vigente' && <button className="btn btn-sm" onClick={() => handleArchivar(a)} title="Archivar"><i className="ti ti-archive"></i></button>}
                  {editable && a.estado === 'archivado' && <button className="btn btn-sm" onClick={() => handleRestaurar(a)} title="Restaurar"><i className="ti ti-arrow-back-up"></i> Restaurar</button>}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Modal Nuevo/Editar */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !saving && setShowModal(false)}>
          <div className="modal" style={{ width: 540, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">{editId ? 'Editar archivo' : 'Nuevo archivo'}</div>
              <button className="btn btn-sm" onClick={() => !saving && setShowModal(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group full"><label>Título *</label><input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} /></div>
              <div className="form-group"><label>Categoría *</label>
                <select value={form.categoria_id} onChange={e => setForm(f => ({ ...f, categoria_id: e.target.value }))}>
                  <option value="">Seleccionar…</option>
                  {catActivas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="form-group"><label>Fecha de término (opcional)</label><input type="date" value={form.fecha_termino} onChange={e => setForm(f => ({ ...f, fecha_termino: e.target.value }))} /></div>
              <div className="form-group full"><label>Resumen</label><textarea rows={2} value={form.resumen} onChange={e => setForm(f => ({ ...f, resumen: e.target.value }))} /></div>
              <div className="form-group full">
                <label>Archivo {!editId && <span style={{ color: '#f09595' }}>*</span>}</label>
                {archivo ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#c8d0dc' }}>
                    <i className="ti ti-file-check" style={{ color: '#5dcaa5' }}></i> {archivo.name} <span style={{ color: 'var(--text-dim)' }}>({formatBytes(archivo.size)})</span>
                    <button className="btn btn-sm" onClick={() => setArchivo(null)}>Quitar</button>
                  </div>
                ) : archivoExistente ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#c8d0dc' }}>
                    <i className="ti ti-file" style={{ color: 'var(--text-muted)' }}></i> {archivoExistente.nombre}
                    <label className="btn btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                      <i className="ti ti-replace"></i> Reemplazar
                      <input type="file" style={{ display: 'none' }} onChange={onPickArchivo} />
                    </label>
                  </div>
                ) : (
                  <label className="btn btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', margin: 0 }}>
                    <i className="ti ti-upload"></i> Subir archivo
                    <input type="file" style={{ display: 'none' }} onChange={onPickArchivo} />
                  </label>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 4 }}>Máximo 100 MB. Cualquier tipo de archivo.</div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)} disabled={saving}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Guardar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Categorías */}
      {showCats && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCats(false)}>
          <div className="modal" style={{ width: 480, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">Categorías de archivos</div>
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
