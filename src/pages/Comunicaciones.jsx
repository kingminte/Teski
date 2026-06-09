import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'

const BUCKET = 'comunicaciones'
const TAMANO_MAX = 100 * 1024 * 1024 // 100 MB

const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const fmtFecha = (iso) => iso ? iso.split('-').reverse().join('/') : ''

// Bytes → tamaño legible (845 KB, 2,3 MB)
const formatBytes = (b) => {
  if (b == null) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}
const sanitizar = (nombre) => (nombre || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '')
const esNuevo = (iso) => {
  if (!iso) return false
  const [y, m, d] = iso.split('-').map(Number)
  return (Date.now() - new Date(y, m - 1, d).getTime()) <= 14 * 24 * 3600 * 1000
}
const iconoArchivo = (c) => {
  if (!c.archivo_path) return { i: 'ti-file-pencil', color: 'var(--text-dim)' }
  const t = `${c.archivo_tipo || ''} ${c.archivo_nombre || ''}`.toLowerCase()
  if (t.includes('pdf')) return { i: 'ti-file-type-pdf', color: '#f09595' }
  if (t.includes('word') || t.includes('.doc')) return { i: 'ti-file-type-doc', color: '#85b7eb' }
  if (t.includes('sheet') || t.includes('excel') || t.includes('.xls') || t.includes('.csv')) return { i: 'ti-file-type-xls', color: '#5dcaa5' }
  if (t.includes('presentation') || t.includes('.ppt')) return { i: 'ti-file-type-ppt', color: '#fac775' }
  return { i: 'ti-file-text', color: 'var(--text-muted)' }
}
const ESTADO_META = {
  borrador: { bg: 'rgba(127,140,158,0.15)', color: '#9aa6b8', txt: 'Borrador' },
  publicada: { bg: 'rgba(29,158,117,0.15)', color: '#5dcaa5', txt: 'Publicada' },
  archivada: { bg: 'rgba(127,140,158,0.1)', color: 'var(--text-dim)', txt: 'Archivada' },
}
const EMPTY = { titulo: '', emisor: '', fecha_publicacion: '', resumen: '', estado: 'borrador' }

export default function Comunicaciones() {
  const { showToast, ToastComponent } = useToast()
  const { user, puedeEditar } = useAuth()
  const editable = puedeEditar('comunicaciones')   // admin/gestor
  const modoSocio = user?.rol === 'socio'

  const [comunicaciones, setComunicaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroAnio, setFiltroAnio] = useState('todas')
  const [filtroEstado, setFiltroEstado] = useState('todas')

  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [archivo, setArchivo] = useState(null)        // File nuevo a subir
  const [archivoExistente, setArchivoExistente] = useState(null) // { path, nombre } al editar
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [descargando, setDescargando] = useState(null)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    let q = supabase.from('comunicaciones').select('*').order('fecha_publicacion', { ascending: false })
    if (modoSocio) q = q.eq('estado', 'publicada')
    const { data } = await q
    setComunicaciones(data || [])
    setLoading(false)
  }

  // ----- Descarga -----
  const handleDescargar = async (c) => {
    if (!c.archivo_path) { showToast('Esta comunicación no tiene archivo', 'error'); return }
    setDescargando(c.id)
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(c.archivo_path, 900, { download: c.archivo_nombre || true })
    setDescargando(null)
    if (error || !data?.signedUrl) { showToast('Error al generar el enlace de descarga', 'error'); return }
    const a = document.createElement('a')
    a.href = data.signedUrl
    a.download = c.archivo_nombre || ''
    document.body.appendChild(a); a.click(); a.remove()
  }

  // ----- Modal -----
  const openNew = () => {
    setForm({ ...EMPTY, fecha_publicacion: hoyISO() })
    setArchivo(null); setArchivoExistente(null); setEditId(null); setShowModal(true)
  }
  const openEdit = (c) => {
    setForm({ titulo: c.titulo, emisor: c.emisor || '', fecha_publicacion: c.fecha_publicacion, resumen: c.resumen || '', estado: c.estado })
    setArchivo(null)
    setArchivoExistente(c.archivo_path ? { path: c.archivo_path, nombre: c.archivo_nombre } : null)
    setEditId(c.id); setShowModal(true)
  }
  const onPickArchivo = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > TAMANO_MAX) { showToast(`El archivo supera el máximo de 100 MB (${formatBytes(f.size)})`, 'error'); e.target.value = ''; return }
    setArchivo(f)
  }

  const subirArchivo = async (comunicacionId, file) => {
    const path = `${comunicacionId}/${Date.now()}_${sanitizar(file.name)}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file)
    if (error) return { error }
    return { cols: { archivo_path: path, archivo_nombre: file.name, archivo_tipo: file.type || null, archivo_tamano: file.size } }
  }

  const handleSave = async () => {
    if (!form.titulo.trim()) { showToast('El título es obligatorio', 'error'); return }
    if (!form.fecha_publicacion) { showToast('La fecha de publicación es obligatoria', 'error'); return }
    const tendraArchivo = !!archivo || !!archivoExistente
    if (form.estado === 'publicada' && !tendraArchivo) { showToast('No se puede publicar sin archivo adjunto', 'error'); return }

    setSaving(true)
    const base = { titulo: form.titulo, emisor: form.emisor || null, fecha_publicacion: form.fecha_publicacion, resumen: form.resumen || null }

    try {
      if (editId) {
        let archivoCols = {}
        let pathViejo = null
        if (archivo) {
          const { error, cols } = await subirArchivo(editId, archivo)
          if (error) throw new Error('No se pudo subir el archivo: ' + error.message)
          archivoCols = cols
          if (archivoExistente?.path && archivoExistente.path !== cols.archivo_path) pathViejo = archivoExistente.path
        }
        const { error } = await supabase.from('comunicaciones')
          .update({ ...base, estado: form.estado, ...archivoCols, updated_at: new Date().toISOString(), updated_by: user?.id || null })
          .eq('id', editId)
        if (error) throw new Error(error.message)
        if (pathViejo) await supabase.storage.from(BUCKET).remove([pathViejo]) // recién después de update OK
        showToast('Comunicación actualizada')
      } else {
        // Insert como borrador primero (para obtener id antes de subir el archivo)
        const { data: ins, error: eIns } = await supabase.from('comunicaciones')
          .insert({ ...base, estado: 'borrador', created_by: user?.id || null }).select().single()
        if (eIns) throw new Error(eIns.message)
        const id = ins.id
        let archivoCols = {}
        if (archivo) {
          const { error, cols } = await subirArchivo(id, archivo)
          if (error) {
            // El borrador queda guardado sin archivo, para reintentar
            setSaving(false); setShowModal(false); loadAll()
            showToast('Borrador guardado, pero falló la subida del archivo. Edita la comunicación para reintentar.', 'error')
            return
          }
          archivoCols = cols
        }
        const { error: eUpd } = await supabase.from('comunicaciones')
          .update({ ...archivoCols, estado: form.estado }).eq('id', id)
        if (eUpd) throw new Error(eUpd.message)
        showToast(form.estado === 'publicada' ? 'Comunicación publicada' : 'Borrador guardado')
      }
      setShowModal(false); loadAll()
    } catch (e) {
      showToast('Error al guardar: ' + e.message, 'error')
    }
    setSaving(false)
  }

  // ----- Acciones de estado -----
  const upd = async (id, patch, msg) => {
    const { error } = await supabase.from('comunicaciones').update({ ...patch, updated_at: new Date().toISOString(), updated_by: user?.id || null }).eq('id', id)
    if (error) showToast('Error: ' + error.message, 'error')
    else { showToast(msg); loadAll() }
  }
  const handlePublicar = (c) => {
    if (!c.archivo_path) { showToast('No se puede publicar sin archivo adjunto. Edita y sube el archivo primero.', 'error'); return }
    upd(c.id, { estado: 'publicada' }, 'Comunicación publicada')
  }
  const handleArchivar = (c) => upd(c.id, { estado: 'archivada' }, 'Comunicación archivada')
  const handleRestaurar = (c) => upd(c.id, { estado: 'publicada' }, 'Comunicación restaurada')
  const handleEliminar = async (c) => {
    if (!confirm('¿Eliminar este borrador? Esta acción es definitiva y borra también el archivo adjunto.')) return
    if (c.archivo_path) await supabase.storage.from(BUCKET).remove([c.archivo_path])
    const { error } = await supabase.from('comunicaciones').delete().eq('id', c.id)
    if (error) showToast('Error al eliminar: ' + error.message, 'error')
    else { showToast('Borrador eliminado'); loadAll() }
  }

  // ============ MODO SOCIO ============
  if (modoSocio) {
    const anios = [...new Set(comunicaciones.map(c => c.fecha_publicacion?.slice(0, 4)).filter(Boolean))].sort((a, b) => b.localeCompare(a))
    const visibles = filtroAnio === 'todas' ? comunicaciones : comunicaciones.filter(c => c.fecha_publicacion?.startsWith(filtroAnio))
    return (
      <div>
        {ToastComponent}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><i className="ti ti-speakerphone"></i> Comunicaciones — Teski Club</div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{comunicaciones.length} comunicado{comunicaciones.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        {loading ? (
          <div className="card"><div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div></div>
        ) : comunicaciones.length === 0 ? (
          <div className="card"><div className="empty-state"><i className="ti ti-speakerphone"></i>Por el momento no hay comunicados publicados.</div></div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' }}>
              <button onClick={() => setFiltroAnio('todas')} className="chip" style={{ cursor: 'pointer', borderColor: filtroAnio === 'todas' ? 'var(--gold)' : undefined, color: filtroAnio === 'todas' ? 'var(--gold-light)' : undefined }}>Todas · {comunicaciones.length}</button>
              {anios.map(a => (
                <button key={a} onClick={() => setFiltroAnio(a)} className="chip" style={{ cursor: 'pointer', borderColor: filtroAnio === a ? 'var(--gold)' : undefined, color: filtroAnio === a ? 'var(--gold-light)' : undefined }}>
                  {a} · {comunicaciones.filter(c => c.fecha_publicacion?.startsWith(a)).length}
                </button>
              ))}
            </div>

            <div className="card">
              {visibles.map(c => {
                const ic = iconoArchivo(c)
                return (
                  <div key={c.id} style={{ display: 'flex', gap: 14, padding: '1rem 1.5rem', borderBottom: '0.5px solid rgba(201,168,76,0.08)', alignItems: 'flex-start' }}>
                    <i className={`ti ${ic.i}`} style={{ fontSize: 30, color: ic.color, flexShrink: 0 }}></i>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, color: '#c8d0dc', fontWeight: 600 }}>{c.titulo}</span>
                        {esNuevo(c.fecha_publicacion) && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(29,158,117,0.15)', color: '#5dcaa5' }}>Nuevo</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', margin: '3px 0' }}>
                        Publicado el {fmtFecha(c.fecha_publicacion)}{c.emisor ? ` · ${c.emisor}` : ''}
                      </div>
                      {c.resumen && <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{c.resumen}</div>}
                    </div>
                    {c.archivo_path && (
                      <button className="btn btn-sm btn-primary" style={{ flexShrink: 0 }} disabled={descargando === c.id} onClick={() => handleDescargar(c)}>
                        {descargando === c.id ? <i className="ti ti-loader"></i> : <><i className="ti ti-download"></i> Descargar</>}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    )
  }

  // ============ MODO ADMIN / LECTOR ============
  const conteo = (est) => comunicaciones.filter(c => c.estado === est).length
  const FILTROS = [
    { id: 'todas', label: `Todas · ${comunicaciones.length}` },
    { id: 'publicada', label: `Publicadas · ${conteo('publicada')}` },
    { id: 'borrador', label: `Borradores · ${conteo('borrador')}` },
    { id: 'archivada', label: `Archivadas · ${conteo('archivada')}` },
  ]
  const filtradas = filtroEstado === 'todas' ? comunicaciones : comunicaciones.filter(c => c.estado === filtroEstado)

  return (
    <div>
      {ToastComponent}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-speakerphone"></i> Comunicaciones</div>
          {editable && <button className="btn btn-primary btn-sm" onClick={openNew}><i className="ti ti-plus"></i> Nueva comunicación</button>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 1.5rem 1rem' }}>
          {FILTROS.map(f => (
            <button key={f.id} className={`btn btn-sm${filtroEstado === f.id ? ' btn-primary' : ''}`} onClick={() => setFiltroEstado(f.id)}>{f.label}</button>
          ))}
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
        ) : filtradas.length === 0 ? (
          <div className="empty-state"><i className="ti ti-speakerphone"></i>Sin comunicaciones en este filtro.</div>
        ) : (
          filtradas.map(c => {
            const ic = iconoArchivo(c)
            const meta = ESTADO_META[c.estado]
            const opaco = c.estado !== 'publicada'
            return (
              <div key={c.id} style={{ display: 'flex', gap: 14, padding: '1rem 1.5rem', borderBottom: '0.5px solid rgba(201,168,76,0.08)', alignItems: 'flex-start', opacity: opaco ? 0.7 : 1 }}>
                <i className={`ti ${ic.i}`} style={{ fontSize: 28, color: ic.color, flexShrink: 0 }}></i>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, color: '#c8d0dc', fontWeight: 600 }}>{c.titulo}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: meta.bg, color: meta.color }}>{meta.txt}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', margin: '3px 0' }}>
                    {fmtFecha(c.fecha_publicacion)}{c.emisor ? ` · ${c.emisor}` : ''}{c.archivo_tamano ? ` · ${formatBytes(c.archivo_tamano)}` : ''}
                  </div>
                  {c.resumen && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{c.resumen}</div>}
                </div>
                {editable && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
                    {c.estado === 'borrador' && <button className="btn btn-sm btn-primary" onClick={() => handlePublicar(c)} title="Publicar"><i className="ti ti-send"></i> Publicar</button>}
                    {(c.estado === 'borrador' || c.estado === 'publicada') && <button className="btn btn-sm" onClick={() => openEdit(c)} title="Editar"><i className="ti ti-edit"></i></button>}
                    {c.archivo_path && <button className="btn btn-sm" disabled={descargando === c.id} onClick={() => handleDescargar(c)} title="Descargar"><i className="ti ti-download"></i></button>}
                    {c.estado === 'publicada' && <button className="btn btn-sm" onClick={() => handleArchivar(c)} title="Archivar"><i className="ti ti-archive"></i></button>}
                    {c.estado === 'archivada' && <button className="btn btn-sm" onClick={() => handleRestaurar(c)} title="Restaurar"><i className="ti ti-arrow-back-up"></i> Restaurar</button>}
                    {c.estado === 'borrador' && <button className="btn btn-sm btn-danger" onClick={() => handleEliminar(c)} title="Eliminar"><i className="ti ti-trash"></i></button>}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Modal Nueva/Editar */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !saving && setShowModal(false)}>
          <div className="modal" style={{ width: 540, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">{editId ? 'Editar comunicación' : 'Nueva comunicación'}</div>
              <button className="btn btn-sm" onClick={() => !saving && setShowModal(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group full"><label>Título *</label><input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} /></div>
              <div className="form-group"><label>Emisor</label><input placeholder="Ej: Directiva, Tesorería" value={form.emisor} onChange={e => setForm(f => ({ ...f, emisor: e.target.value }))} /></div>
              <div className="form-group"><label>Fecha de publicación *</label><input type="date" value={form.fecha_publicacion} onChange={e => setForm(f => ({ ...f, fecha_publicacion: e.target.value }))} /></div>
              <div className="form-group full"><label>Resumen</label><textarea rows={2} placeholder="Breve descripción de qué trata" value={form.resumen} onChange={e => setForm(f => ({ ...f, resumen: e.target.value }))} /></div>
              <div className="form-group full">
                <label>Archivo {form.estado === 'publicada' && <span style={{ color: '#f09595' }}>* (requerido para publicar)</span>}</label>
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
              <div className="form-group full"><label>Guardar como</label>
                <select value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}>
                  <option value="borrador">Borrador</option>
                  <option value="publicada">Publicada</option>
                </select>
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
    </div>
  )
}
