import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import RutInput from '../components/RutInput'
import { useBancos } from '../lib/useBancos'

const EMPTY_FORM = {
  nombre: '', apellido: '', rut: '', fecha_nacimiento: '', email: '',
  telefono: '', direccion: '',
  fecha_ingreso: new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
  estado: 'activo', banco: 'Banco Estado', valor_cuota: 12000,
  comentarios: '', fecha_inactividad: '',
}

const AVATAR_COLORS = [
  { bg: 'rgba(83,74,183,0.3)', color: '#afa9ec' },
  { bg: 'rgba(29,158,117,0.2)', color: '#5dcaa5' },
  { bg: 'rgba(186,117,23,0.25)', color: '#fac775' },
  { bg: 'rgba(153,60,86,0.25)', color: '#ed93b1' },
  { bg: 'rgba(163,45,45,0.25)', color: '#f09595' },
]

function getAvatarColor(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function estadoBadge(estado) {
  if (estado === 'activo') return <span className="badge badge-active">Activo</span>
  if (estado === 'pendiente') return <span className="badge badge-pending">Pendiente</span>
  return <span className="badge badge-inactive">Inactivo</span>
}

export default function Socios() {
  const navigate = useNavigate()
  const { showToast, ToastComponent } = useToast()
  const { user, puedeEditar } = useAuth()
  const editable = puedeEditar('socios')
  const esSocio = user?.rol === 'socio'
  const miSocioId = user?.socio_id
  const fileRef = useRef()
  const [socios, setSocios] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [rutValido, setRutValido] = useState(false)
  const [adjuntos, setAdjuntos] = useState([])
  const { bancos } = useBancos()
  const [uploadingFile, setUploadingFile] = useState(false)

  const load = async () => {
    setLoading(true)
    let query = supabase.from('vista_socios').select('*').order('numero_socio', { ascending: true })
    if (esSocio && miSocioId) query = query.eq('id', miSocioId)
    const { data, error } = await query
    if (!error) setSocios(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const loadAdjuntos = async (socioId) => {
    const { data } = await supabase.storage.from('cartolas').list(`socios/${socioId}`)
    setAdjuntos(data || [])
  }

  const filtered = socios.filter(s =>
    `${s.nombre} ${s.apellido} ${s.rut} ${s.numero_socio}`.toLowerCase().includes(search.toLowerCase())
  )

  const openNew = () => {
    const last = socios.length > 0
      ? Math.max(...socios.map(s => parseInt(s.numero_socio?.replace('S-', '') || 0))) : 0
    setForm({ ...EMPTY_FORM, numero_socio: `S-${String(last + 1).padStart(3, '0')}` })
    setEditId(null); setRutValido(false); setAdjuntos([]); setShowModal(true)
  }

  const openEdit = (s) => {
    setForm({
      numero_socio: s.numero_socio || '',
      nombre: s.nombre || '',
      apellido: s.apellido || '',
      rut: s.rut || '',
      fecha_nacimiento: s.fecha_nacimiento || '',
      email: s.email || '',
      telefono: s.telefono || '',
      direccion: s.direccion || '',
      fecha_ingreso: s.fecha_ingreso || new Date().toISOString().slice(0,10),
      estado: s.estado || 'activo',
      banco: s.banco || 'Banco Estado',
      valor_cuota: s.valor_cuota || 12000,
      comentarios: s.comentarios || '',
      fecha_inactividad: s.fecha_inactividad || '',
    })
    setEditId(s.id); setRutValido(true); loadAdjuntos(s.id); setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.nombre || !form.apellido || !form.rut) { showToast('Nombre, apellido y RUT son obligatorios', 'error'); return }
    if (!rutValido) { showToast('El RUT ingresado no es válido', 'error'); return }
    setSaving(true)
    const payload = {
      ...form,
      valor_cuota: parseInt(String(form.valor_cuota).replace(/\./g,'').replace(/[^0-9]/g,'')) || 0,
      fecha_nacimiento: form.fecha_nacimiento || null,
      fecha_inactividad: form.estado === 'inactivo' ? (form.fecha_inactividad || null) : null,
      banco: form.banco || null,
      telefono: form.telefono || null,
      direccion: form.direccion || null,
      email: form.email || null,
      comentarios: form.comentarios || null,
    }
    const estadoAnterior = editId ? socios.find(s => s.id === editId)?.estado : null
    let error
    if (editId) {
      ;({ error } = await supabase.from('socios').update(payload).eq('id', editId))
    } else {
      ;({ error } = await supabase.from('socios').insert(payload))
    }
    if (error) {
      setSaving(false)
      showToast(error.message.includes('unique') ? 'RUT o número de socio ya existe' : 'Error al guardar: ' + error.message, 'error')
      return
    }

    let mensajeExtra = ''
    if (editId && estadoAnterior !== form.estado) {
      if (form.estado === 'inactivo' && estadoAnterior !== 'inactivo') {
        const { data: benes } = await supabase.from('beneficiarios').select('id,estado').eq('socio_id', editId)
        for (const b of (benes || [])) {
          await supabase.from('beneficiarios').update({ estado_previo: b.estado, estado: 'inactivo' }).eq('id', b.id)
        }
        if (benes?.length) mensajeExtra = ` · ${benes.length} beneficiario(s) desactivado(s)`
      } else if (form.estado === 'activo' && estadoAnterior === 'inactivo') {
        const { data: benes } = await supabase.from('beneficiarios').select('id,estado_previo').eq('socio_id', editId)
        for (const b of (benes || [])) {
          await supabase.from('beneficiarios').update({ estado: b.estado_previo || 'vigente', estado_previo: null }).eq('id', b.id)
        }
        if (benes?.length) mensajeExtra = ` · ${benes.length} beneficiario(s) restaurado(s)`
      }
    }

    setSaving(false)
    showToast((editId ? 'Socio actualizado' : 'Socio creado') + mensajeExtra)
    setShowModal(false)
    load()
  }

  const handleDelete = async (id) => {
    const { error } = await supabase.from('socios').delete().eq('id', id)
    if (error) showToast('Error al eliminar socio', 'error')
    else { showToast('Socio eliminado'); load() }
    setConfirmDelete(null)
  }

  const handleFileUpload = async (file) => {
    if (!file || !editId) return
    setUploadingFile(true)
    const path = `socios/${editId}/${Date.now()}_${file.name}`
    const { error } = await supabase.storage.from('cartolas').upload(path, file)
    if (error) showToast('Error al subir archivo', 'error')
    else { showToast('Archivo subido'); loadAdjuntos(editId) }
    setUploadingFile(false)
  }

  const handleDeleteAdjunto = async (name) => {
    await supabase.storage.from('cartolas').remove([`socios/${editId}/${name}`])
    showToast('Archivo eliminado'); loadAdjuntos(editId)
  }

  const handleVerAdjunto = async (name) => {
    const { data } = await supabase.storage.from('cartolas').createSignedUrl(`socios/${editId}/${name}`, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else showToast('Error al obtener el archivo', 'error')
  }

  const handleDescargarAdjunto = async (name) => {
    const { data } = await supabase.storage.from('cartolas').createSignedUrl(`socios/${editId}/${name}`, 60)
    if (data?.signedUrl) {
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = name.replace(/^\d+_/, '')
      a.click()
    } else showToast('Error al descargar', 'error')
  }

  const F = (key) => ({ value: form[key] || '', onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) })

  return (
    <div>
      {ToastComponent}
      {esSocio && !miSocioId && (
        <div className="empty-state">
          <i className="ti ti-alert-circle"></i>
          Tu cuenta no está vinculada a un socio. Contacta al administrador.
        </div>
      )}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-users"></i> {esSocio ? 'Mi información' : `Registro de socios (${socios.length})`}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!esSocio && (
              <div className="search-box">
                <i className="ti ti-search"></i>
                <input placeholder="Buscar por nombre, RUT o número…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            )}
            {editable && <button className="btn btn-primary" onClick={openNew}><i className="ti ti-plus"></i> Nuevo socio</button>}
          </div>
        </div>
        {loading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando socios…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><i className="ti ti-users-off"></i>{search ? 'Sin resultados' : 'No hay socios registrados aún'}</div>
        ) : (
          <table>
            <thead><tr><th>Socio</th><th>RUT</th><th>N° Socio</th><th>Beneficiarios</th><th>Estado</th>{editable && <th>Acciones</th>}</tr></thead>
            <tbody>
              {filtered.map(s => {
                const ac = getAvatarColor(s.nombre)
                return (
                  <tr key={s.id}>
                    <td>
                      <div className="name-cell">
                        <div className="avatar" style={{ background: ac.bg, color: ac.color }}>{s.nombre?.[0]}{s.apellido?.[0]}</div>
                        <div><div>{s.nombre} {s.apellido}</div><div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{s.email}</div></div>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{s.rut}</td>
                    <td><span className="chip">{s.numero_socio}</span></td>
                    <td style={{ color: 'var(--text-muted)' }}>{s.total_beneficiarios || 0} registrados</td>
                    <td>{estadoBadge(s.estado)}</td>
                    {editable && (
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm" title="Beneficiarios" onClick={() => navigate(`/beneficiarios/${s.id}`)}><i className="ti ti-heart"></i></button>
                          <button className="btn btn-sm" title="Editar" onClick={() => openEdit(s)}><i className="ti ti-edit"></i></button>
                          <button className="btn btn-sm btn-danger" title="Eliminar" onClick={() => setConfirmDelete(s)}><i className="ti ti-trash"></i></button>
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

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ width: 620 }}>
            <div className="modal-header">
              <div className="modal-title">{editId ? 'Editar socio' : 'Registrar nuevo socio'}</div>
              <button className="btn btn-sm" onClick={() => setShowModal(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Nombre *</label><input placeholder="Juan" {...F('nombre')} /></div>
              <div className="form-group"><label>Apellido *</label><input placeholder="Pérez" {...F('apellido')} /></div>
              <div className="form-group">
                <label>RUT *</label>
                <RutInput value={form.rut}
                  onChange={val => setForm(f => ({ ...f, rut: val }))}
                  onValidChange={(valido, formateado) => { setRutValido(valido); if (valido) setForm(f => ({ ...f, rut: formateado })) }}
                  required />
              </div>
              <div className="form-group"><label>Fecha de nacimiento</label><input type="date" {...F('fecha_nacimiento')} /></div>
              <div className="form-group"><label>N° Socio</label><input placeholder="S-001" {...F('numero_socio')} /></div>
              <div className="form-group"><label>Fecha de ingreso</label><input type="date" {...F('fecha_ingreso')} /></div>
              <div className="form-group"><label>Correo electrónico</label><input type="email" placeholder="correo@ejemplo.com" {...F('email')} /></div>
              <div className="form-group"><label>Teléfono</label><input placeholder="+56 9 1234 5678" {...F('telefono')} /></div>
              <div className="form-group full"><label>Dirección</label><input placeholder="Calle, número, ciudad" {...F('direccion')} /></div>
              <div className="form-group">
                <label>Estado</label>
                <select {...F('estado')}>
                  <option value="activo">Activo</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </div>
              {form.estado === 'inactivo' && (
                <div className="form-group">
                  <label>Fecha de inactividad</label>
                  <input type="date" {...F('fecha_inactividad')} />
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, fontFamily: 'sans-serif' }}>
                    Desde esta fecha el socio no genera obligación de pago
                  </div>
                </div>
              )}
              <div className="form-group">
                <label>Banco</label>
                <select {...F('banco')}>
                  {['Banco Estado','BCI','Santander','Scotiabank','Falabella','Itaú','Security'].map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div className="form-group full">
                <label>Comentarios / Descripción</label>
                <textarea rows={3} placeholder="Observaciones sobre el socio…" style={{ resize: 'vertical' }} {...F('comentarios')} />
              </div>
            </div>

            {editId && (
              <div style={{ padding: '0 1.5rem 1.25rem', borderTop: '0.5px solid var(--border)', paddingTop: '1rem' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Documentos adjuntos</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {adjuntos.length === 0
                    ? <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Sin documentos adjuntos</span>
                    : adjuntos.map(a => (
                      <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(201,168,76,0.07)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
                        <i className="ti ti-file" style={{ color: 'var(--gold)', fontSize: 15 }}></i>
                        <span style={{ color: '#c8d0dc', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.name.replace(/^\d+_/, '')}
                        </span>
                        <button className="btn btn-sm" style={{ color: '#5dcaa5', borderColor: 'rgba(29,158,117,0.4)', padding: '2px 6px' }}
                          onClick={() => handleVerAdjunto(a.name)} title="Ver">
                          <i className="ti ti-eye"></i>
                        </button>
                        <button className="btn btn-sm" style={{ padding: '2px 6px' }}
                          onClick={() => handleDescargarAdjunto(a.name)} title="Descargar">
                          <i className="ti ti-download"></i>
                        </button>
                        <button className="btn btn-sm btn-danger" style={{ padding: '2px 6px' }}
                          onClick={() => handleDeleteAdjunto(a.name)} title="Eliminar">
                          <i className="ti ti-trash"></i>
                        </button>
                      </div>
                    ))}
                </div>
                <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => handleFileUpload(e.target.files[0])} />
                <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={uploadingFile}>
                  {uploadingFile ? <><i className="ti ti-loader"></i> Subiendo…</> : <><i className="ti ti-upload"></i> Subir documento</>}
                </button>
              </div>
            )}
            {!editId && (
              <div style={{ padding: '0 1.5rem 1rem' }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Podrás adjuntar documentos luego de guardar el socio.</span>
              </div>
            )}

            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editId ? 'Guardar cambios' : 'Registrar socio'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal" style={{ width: 400 }}>
            <div className="modal-header">
              <div className="modal-title" style={{ color: 'var(--danger)' }}>Eliminar socio</div>
              <button className="btn btn-sm" onClick={() => setConfirmDelete(null)}><i className="ti ti-x"></i></button>
            </div>
            <div style={{ padding: '1.5rem', fontFamily: 'sans-serif', fontSize: 14, color: 'var(--text-muted)' }}>
              ¿Estás seguro de eliminar a <strong style={{ color: 'var(--text)' }}>{confirmDelete.nombre} {confirmDelete.apellido}</strong>?
              <br /><br />Se eliminarán también sus beneficiarios y el historial de cuotas asociado.
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete.id)}>
                <i className="ti ti-trash"></i> Confirmar eliminación
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
