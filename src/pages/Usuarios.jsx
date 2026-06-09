import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'

const CICLO_NIVEL = { completo: 'lectura', lectura: 'ninguno', ninguno: 'completo' }
const LABEL_NIVEL = { completo: 'completo', lectura: 'solo lectura', ninguno: 'sin acceso' }

const ROLES = [
  { value: 'admin', label: 'Administrador', icon: 'ti-shield', background: 'rgba(163,45,45,0.15)', color: '#f09595' },
  { value: 'gestor', label: 'Gestor', icon: 'ti-tool', background: 'rgba(55,138,221,0.15)', color: '#85b7eb' },
  { value: 'lector', label: 'Lector', icon: 'ti-eye', background: 'rgba(175,169,236,0.15)', color: '#afa9ec' },
  { value: 'andacor', label: 'Andacor', icon: 'ti-search', background: 'rgba(239,159,39,0.15)', color: '#fac775' },
  { value: 'socio', label: 'Socio', icon: 'ti-user', background: 'rgba(29,158,117,0.15)', color: '#5dcaa5' },
]

const SECCIONES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'ti-dashboard' },
  { id: 'socios', label: 'Socios', icon: 'ti-users' },
  { id: 'beneficiarios', label: 'Beneficiarios', icon: 'ti-heart' },
  { id: 'cuotas', label: 'Cuotas', icon: 'ti-receipt' },
  { id: 'socios_activos', label: 'Socios activos', icon: 'ti-list-check' },
  { id: 'cartola', label: 'Cartola bancaria', icon: 'ti-file-spreadsheet' },
  { id: 'cheques', label: 'Cheques recibidos', icon: 'ti-writing' },
  { id: 'chequera', label: 'Control chequera', icon: 'ti-book' },
  { id: 'cuentas_por_pagar', label: 'Cuentas por pagar', icon: 'ti-file-invoice' },
  { id: 'otros_ingresos', label: 'Otros ingresos', icon: 'ti-coin' },
  { id: 'cobranza', label: 'Cobranza', icon: 'ti-mail-forward' },
  { id: 'configuracion', label: 'Configuración', icon: 'ti-settings' },
  { id: 'reporteria', label: 'Reportería', icon: 'ti-chart-bar' },
  { id: 'usuarios', label: 'Usuarios', icon: 'ti-shield-lock' },
  { id: 'clases_solicitar', label: 'Clases · Solicitar', icon: 'ti-ski-jumping' },
  { id: 'clases_gestion', label: 'Clases · Gestión', icon: 'ti-clipboard-list' },
  { id: 'clases_catalogos', label: 'Clases · Gestión Escuela', icon: 'ti-list-details' },
  { id: 'clases_config', label: 'Clases · Configuración', icon: 'ti-adjustments' },
  { id: 'clases_reporte', label: 'Clases · Reporte', icon: 'ti-report-money' },
  { id: 'beneficios', label: 'Beneficios', icon: 'ti-gift' },
  { id: 'comunicaciones', label: 'Comunicaciones', icon: 'ti-speakerphone' },
  { id: 'archivos_directorio', label: 'Archivos Directorio', icon: 'ti-folder' },
]

const DESCRIPCION_ROLES = [
  { rol: 'admin', titulo: 'Administrador', texto: 'Acceso completo. Crea usuarios, gestiona roles, resetea claves.' },
  { rol: 'gestor', titulo: 'Gestor', texto: 'Opera la plataforma completa. Sin acceso a configuración ni usuarios.' },
  { rol: 'lector', titulo: 'Lector', texto: 'Solo lectura. Ve información sin modificar.' },
  { rol: 'andacor', titulo: 'Andacor', texto: 'Auditor externo. Solo lectura en información financiera.' },
  { rol: 'socio', titulo: 'Socio', texto: 'Solo ve su propia cuenta: cuotas y beneficiarios.' },
]

const EMPTY_USUARIO = { nombre: '', username: '', email: '', password: '', rol: 'gestor', socio_id: '' }

async function hashPassword(pass) {
  const enc = new TextEncoder().encode(pass)
  const hash = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const formatearAcceso = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  const hoy = new Date()
  const sameDay = d.toDateString() === hoy.toDateString()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (sameDay) return `Hoy, ${hh}:${mm}`
  const dd = String(d.getDate()).padStart(2, '0')
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mes}/${d.getFullYear()}`
}

const getIniciales = (nombre) => {
  const partes = (nombre || '').trim().split(/\s+/)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[1][0]).toUpperCase()
}

const rolMeta = (rol) => ROLES.find(r => r.value === rol) || ROLES[4]

export default function Usuarios() {
  const { showToast, ToastComponent } = useToast()
  const { esAdmin, puedeEditar } = useAuth()
  const editable = puedeEditar('usuarios')
  const [tab, setTab] = useState('usuarios')
  const [usuarios, setUsuarios] = useState([])
  const [socios, setSocios] = useState([])
  const [permisos, setPermisos] = useState([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtroRol, setFiltroRol] = useState('todos')

  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_USUARIO)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [esSocio, setEsSocio] = useState(false)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    const [usuariosRes, sociosRes, permisosRes] = await Promise.all([
      supabase.from('usuarios').select('*, socios(numero_socio,nombre,apellido)').order('created_at', { ascending: false }),
      supabase.from('socios').select('id,numero_socio,nombre,apellido,email').order('numero_socio'),
      supabase.from('permisos_rol').select('*'),
    ])
    setUsuarios(usuariosRes.data || [])
    setSocios(sociosRes.data || [])
    setPermisos(permisosRes.data || [])
    setLoading(false)
  }

  const nivelDe = (rol, seccion) => permisos.find(p => p.rol === rol && p.seccion === seccion)?.nivel || 'ninguno'

  const handleTogglePermiso = async (rol, seccion) => {
    if (rol === 'admin' || !esAdmin()) return
    const nivelActual = nivelDe(rol, seccion)
    const nuevoNivel = CICLO_NIVEL[nivelActual] || 'completo'
    setPermisos(prev => prev.map(p => p.rol === rol && p.seccion === seccion ? { ...p, nivel: nuevoNivel } : p))
    const { error } = await supabase.from('permisos_rol').update({ nivel: nuevoNivel }).eq('rol', rol).eq('seccion', seccion)
    if (error) {
      showToast('Error al actualizar permiso', 'error')
      loadAll()
    } else {
      const rolLabel = ROLES.find(r => r.value === rol)?.label || rol
      const seccionLabel = SECCIONES.find(s => s.id === seccion)?.label || seccion
      showToast(`${rolLabel} → ${seccionLabel}: ${LABEL_NIVEL[nuevoNivel]}`)
    }
  }

  const abrirNuevo = () => {
    setForm(EMPTY_USUARIO)
    setEsSocio(false)
    setEditId(null)
    setShowModal(true)
  }

  const abrirEditar = (u) => {
    setForm({
      nombre: u.nombre || '',
      username: u.username || '',
      email: u.email || '',
      password: '',
      rol: u.rol || 'gestor',
      socio_id: u.socio_id || '',
    })
    setEsSocio(!!u.socio_id)
    setEditId(u.id)
    setShowModal(true)
  }

  const handleSeleccionarSocio = (socioId) => {
    if (!socioId) { setForm(f => ({ ...f, socio_id: '', nombre: '', email: '', username: '', password: '' })); return }
    const socio = socios.find(s => s.id === socioId)
    if (!socio) return
    const limpiar = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
    const primera = limpiar(socio.nombre)[0] || ''
    const apellido = limpiar((socio.apellido || '').split(' ')[0])
    const username = primera + apellido
    const password = username + '2026'
    setForm({
      nombre: `${socio.nombre} ${socio.apellido}`,
      email: socio.email || '',
      username,
      password,
      rol: 'socio',
      socio_id: socioId,
    })
  }

  const handleGuardar = async () => {
    if (!form.nombre.trim()) { showToast('El nombre es obligatorio', 'error'); return }
    if (!form.username.trim()) { showToast('El username es obligatorio', 'error'); return }
    if (!editId && esSocio && !form.socio_id) { showToast('Selecciona un socio', 'error'); return }
    if (!editId && (!form.password || form.password.length < 6)) { showToast('La contraseña debe tener al menos 6 caracteres', 'error'); return }
    if (editId && form.password && form.password.length < 6) { showToast('La nueva contraseña debe tener al menos 6 caracteres', 'error'); return }

    setSaving(true)
    try {
      let error
      if (editId) {
        const payload = {
          nombre: form.nombre.trim(),
          username: form.username.trim().toLowerCase(),
          email: form.email || null,
          rol: form.rol,
          socio_id: form.socio_id || null,
        }
        if (form.password) payload.password_hash = await hashPassword(form.password)
        ;({ error } = await supabase.from('usuarios').update(payload).eq('id', editId))
      } else {
        const passwordHash = await hashPassword(form.password)
        const payload = {
          nombre: form.nombre.trim(),
          username: form.username.trim().toLowerCase(),
          email: form.email || null,
          password_hash: passwordHash,
          rol: form.rol,
          socio_id: form.socio_id || null,
        }
        ;({ error } = await supabase.from('usuarios').insert(payload))
      }
      if (error) {
        showToast(error.message.includes('unique') || error.code === '23505' ? 'El username ya existe' : 'Error al guardar: ' + error.message, 'error')
      } else {
        showToast(editId ? 'Usuario actualizado' : 'Usuario creado')
        setShowModal(false)
        loadAll()
      }
    } catch (e) {
      showToast('Error inesperado: ' + (e?.message || 'desconocido'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleResetearClave = async (u) => {
    if (!confirm(`¿Resetear la clave de ${u.nombre}? La nueva clave será: teski2026 (se le pedirá cambiarla al loguearse)`)) return
    const hash = await hashPassword('teski2026')
    const { error } = await supabase.from('usuarios').update({ password_hash: hash, debe_cambiar_clave: true }).eq('id', u.id)
    if (error) showToast('Error al resetear', 'error')
    else showToast('Clave reseteada. Nueva clave: teski2026 — el usuario deberá cambiarla al ingresar')
  }

  const handleToggleActivo = async (u) => {
    const { error } = await supabase.from('usuarios').update({ activo: !u.activo }).eq('id', u.id)
    if (error) showToast('Error', 'error')
    else { showToast(u.activo ? 'Usuario desactivado' : 'Usuario activado'); loadAll() }
  }

  const handleDeleteUsuario = async (u) => {
    if (u.rol === 'admin') { showToast('No se puede eliminar al administrador', 'error'); return }
    if (!confirm(`¿Eliminar al usuario ${u.nombre} (@${u.username})? Esta acción no se puede deshacer.`)) return
    const { error } = await supabase.from('usuarios').delete().eq('id', u.id)
    if (error) showToast('Error al eliminar: ' + error.message, 'error')
    else { showToast('Usuario eliminado'); loadAll() }
  }

  const usuariosFiltrados = usuarios.filter(u => {
    if (filtroRol !== 'todos' && u.rol !== filtroRol) return false
    const q = busqueda.toLowerCase().trim()
    if (q && !`${u.nombre} ${u.username} ${u.email || ''}`.toLowerCase().includes(q)) return false
    return true
  })

  const stats = {
    total: usuarios.length,
    admin: usuarios.filter(u => u.rol === 'admin').length,
    gestor: usuarios.filter(u => u.rol === 'gestor').length,
    lector: usuarios.filter(u => u.rol === 'lector').length,
    socio: usuarios.filter(u => u.rol === 'socio').length,
  }

  const renderIcono = (nivel) => {
    if (nivel === 'completo') return <i className="ti ti-check" style={{ color: '#5dcaa5', fontSize: 17 }}></i>
    if (nivel === 'lectura') return <i className="ti ti-eye" style={{ color: '#fac775', fontSize: 17 }}></i>
    return <i className="ti ti-x" style={{ color: 'var(--text-dim)', opacity: 0.5, fontSize: 15 }}></i>
  }

  const renderNivelCelda = (rol, seccion) => {
    const nivel = nivelDe(rol, seccion)
    const editable = rol !== 'admin' && esAdmin()
    const proximo = CICLO_NIVEL[nivel] || 'completo'
    const title = rol === 'admin'
      ? 'Admin siempre tiene acceso completo'
      : !esAdmin()
        ? 'Solo el administrador puede editar permisos'
        : `Clic para cambiar a ${LABEL_NIVEL[proximo]}`
    return (
      <div
        onClick={() => editable && handleTogglePermiso(rol, seccion)}
        title={title}
        style={{
          cursor: editable ? 'pointer' : 'default',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, borderRadius: 4,
          transition: 'background 0.15s',
          background: 'transparent',
        }}
        onMouseEnter={e => { if (editable) e.currentTarget.style.background = 'rgba(201,168,76,0.08)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        {renderIcono(nivel)}
      </div>
    )
  }

  return (
    <div>
      {ToastComponent}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', marginBottom: '1.5rem' }}>
        {[
          { id: 'usuarios', icon: 'ti-users', label: 'Usuarios' },
          { id: 'permisos', icon: 'ti-shield-check', label: 'Roles y permisos' },
        ].map(t => (
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

      {/* TAB USUARIOS */}
      {tab === 'usuarios' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: '1.5rem' }}>
            {[
              { label: 'Total', value: stats.total, color: 'var(--gold-light)' },
              { label: 'Admins', value: stats.admin, color: '#f09595' },
              { label: 'Gestores', value: stats.gestor, color: '#85b7eb' },
              { label: 'Lectores', value: stats.lector, color: '#afa9ec' },
              { label: 'Socios', value: stats.socio, color: '#5dcaa5' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title"><i className="ti ti-users"></i> Usuarios del sistema</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select value={filtroRol} onChange={e => setFiltroRol(e.target.value)} style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}>
                  <option value="todos">Todos los roles</option>
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <div className="search-box">
                  <i className="ti ti-search"></i>
                  <input placeholder="Buscar…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
                </div>
                {editable && (
                  <button className="btn btn-primary btn-sm" onClick={abrirNuevo}>
                    <i className="ti ti-plus"></i> Nuevo usuario
                  </button>
                )}
              </div>
            </div>
            {loading ? (
              <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
            ) : usuariosFiltrados.length === 0 ? (
              <div className="empty-state"><i className="ti ti-user-off"></i>{usuarios.length === 0 ? 'Sin usuarios registrados' : 'Sin resultados'}</div>
            ) : (
              <table>
                <thead>
                  <tr><th>Usuario</th><th>Email</th><th>Rol</th><th>Socio vinculado</th><th>Último acceso</th><th>Estado</th><th>Acciones</th></tr>
                </thead>
                <tbody>
                  {usuariosFiltrados.map(u => {
                    const meta = rolMeta(u.rol)
                    return (
                      <tr key={u.id} style={{ opacity: u.activo ? 1 : 0.6 }}>
                        <td>
                          <div className="name-cell">
                            <div className="avatar" style={{ background: meta.background, color: meta.color }}>
                              {getIniciales(u.nombre)}
                            </div>
                            <div>
                              <div>{u.nombre}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>@{u.username}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{u.email || '—'}</td>
                        <td>
                          <span className="badge" style={{ background: meta.background, color: meta.color, border: `0.5px solid ${meta.color}33` }}>
                            <i className={`ti ${meta.icon}`} style={{ fontSize: 11, marginRight: 4 }}></i>{meta.label}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {u.socios ? `${u.socios.numero_socio} — ${u.socios.nombre} ${u.socios.apellido}` : '—'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatearAcceso(u.ultimo_acceso)}</td>
                        <td>
                          {u.activo ? <span className="badge badge-active">Activo</span> : <span className="badge badge-inactive">Inactivo</span>}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {editable && <button className="btn btn-sm" onClick={() => abrirEditar(u)} title="Editar"><i className="ti ti-edit"></i></button>}
                            {editable && <button className="btn btn-sm" onClick={() => handleResetearClave(u)} title="Resetear clave"><i className="ti ti-key"></i></button>}
                            {editable && <button className="btn btn-sm" onClick={() => handleToggleActivo(u)} title={u.activo ? 'Desactivar' : 'Activar'}>
                              <i className={`ti ${u.activo ? 'ti-user-off' : 'ti-user-check'}`}></i>
                            </button>}
                            {editable && u.rol !== 'admin' && (
                              <button className="btn btn-sm btn-danger" onClick={() => handleDeleteUsuario(u)} title="Eliminar usuario">
                                <i className="ti ti-trash"></i>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {showModal && (
            <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
              <div className="modal" style={{ width: 600, maxHeight: '90vh', overflowY: 'auto' }}>
                <div className="modal-header">
                  <div className="modal-title">{editId ? 'Editar usuario' : 'Nuevo usuario'}</div>
                  <button className="btn btn-sm" onClick={() => setShowModal(false)}><i className="ti ti-x"></i></button>
                </div>

                {!editId && (
                  <div style={{ padding: '0 1.25rem 0.75rem' }}>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 6 }}>¿El usuario es un socio del club?</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className={`btn btn-sm${esSocio ? ' btn-primary' : ''}`} onClick={() => setEsSocio(true)}>
                        <i className="ti ti-check"></i> Sí, es socio
                      </button>
                      <button className={`btn btn-sm${!esSocio ? ' btn-primary' : ''}`}
                        onClick={() => { setEsSocio(false); setForm({ ...EMPTY_USUARIO, rol: 'gestor' }) }}>
                        <i className="ti ti-user"></i> No, es externo
                      </button>
                    </div>
                  </div>
                )}

                {!editId && esSocio && (
                  <div style={{ padding: '0 1.25rem 0.5rem' }}>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 6 }}>Seleccionar socio *</label>
                    <select value={form.socio_id} onChange={e => handleSeleccionarSocio(e.target.value)} style={{ width: '100%' }}>
                      <option value="">Seleccionar socio…</option>
                      {socios
                        .filter(s => !usuarios.some(u => u.socio_id === s.id))
                        .map(s => <option key={s.id} value={s.id}>{s.numero_socio} — {s.nombre} {s.apellido}</option>)}
                    </select>
                    {form.socio_id && (
                      <div style={{ background: 'rgba(29,158,117,0.1)', border: '0.5px solid rgba(29,158,117,0.3)', borderRadius: 8, padding: '0.75rem 1rem', marginTop: 10, fontSize: 12, fontFamily: 'sans-serif' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, color: '#5dcaa5', fontWeight: 500 }}>
                          <i className="ti ti-user-check" style={{ fontSize: 16 }}></i> Datos generados automáticamente
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, color: 'var(--text-muted)' }}>
                          <span>Usuario: <strong style={{ color: '#c8d0dc' }}>{form.username}</strong></span>
                          <span>Clave: <strong style={{ color: '#c8d0dc' }}>{form.password}</strong></span>
                          <span>Email: <strong style={{ color: form.email ? '#c8d0dc' : 'var(--text-dim)' }}>{form.email || 'Sin email registrado'}</strong></span>
                          <span>Rol: <strong style={{ color: '#5dcaa5' }}>Socio</strong></span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="form-grid">
                  <div className="form-group full"><label>Nombre completo *</label>
                    <input placeholder="Ej: Juan Pérez" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
                  </div>
                  <div className="form-group"><label>Username *</label>
                    <input placeholder="ej: jperez" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
                    {!editId && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, fontFamily: 'sans-serif' }}>
                        Primera letra del nombre + primer apellido
                      </div>
                    )}
                  </div>
                  <div className="form-group"><label>Email</label>
                    <input type="email" placeholder="Email del usuario" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div className="form-group full">
                    <label>{editId ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña * (mínimo 6 caracteres)'}</label>
                    <input type="text" placeholder={editId ? 'Dejar vacío para mantener actual' : '••••••••'} value={form.password || ''} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                    {!editId && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, fontFamily: 'sans-serif' }}>
                        username + 2026
                      </div>
                    )}
                  </div>
                  <div className="form-group"><label>Rol *</label>
                    <select value={form.rol} onChange={e => setForm(f => ({ ...f, rol: e.target.value }))}>
                      {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                  {esSocio ? (
                    <div className="form-group"><label>Socio vinculado</label>
                      <input value={socios.find(s => s.id === form.socio_id)?.numero_socio || ''} disabled />
                    </div>
                  ) : (
                    <div className="form-group"><label>Vincular a socio (opcional)</label>
                      <select value={form.socio_id} onChange={e => setForm(f => ({ ...f, socio_id: e.target.value }))}>
                        <option value="">Sin vincular</option>
                        {socios.map(s => <option key={s.id} value={s.id}>{s.numero_socio} — {s.nombre} {s.apellido}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button className="btn" onClick={() => setShowModal(false)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={handleGuardar} disabled={saving}>
                    {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editId ? 'Guardar cambios' : 'Crear usuario'}</>}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* TAB PERMISOS */}
      {tab === 'permisos' && (
        <>
          <div className="card">
            <div className="card-header">
              <div className="card-title"><i className="ti ti-shield-check"></i> Matriz de permisos</div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                {esAdmin() && <><i className="ti ti-pointer" style={{ marginRight: 4 }}></i>Clic para cambiar &nbsp;·&nbsp;</>}
                <i className="ti ti-check" style={{ color: '#5dcaa5' }}></i> completo &nbsp;·&nbsp;
                <i className="ti ti-eye" style={{ color: '#fac775' }}></i> solo lectura &nbsp;·&nbsp;
                <i className="ti ti-x" style={{ color: 'var(--text-dim)' }}></i> sin acceso
              </span>
            </div>
            <div style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '200px repeat(5, 1fr)', gap: 0 }}>
                {/* Header */}
                <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', borderBottom: '0.5px solid var(--border)' }}>Sección</div>
                {ROLES.map(r => (
                  <div key={r.value} style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '0.5px solid var(--border)' }}>
                    <span className="badge" style={{ background: r.background, color: r.color, border: `0.5px solid ${r.color}33` }}>
                      <i className={`ti ${r.icon}`} style={{ fontSize: 11, marginRight: 4 }}></i>{r.label}
                    </span>
                  </div>
                ))}
                {/* Filas */}
                {SECCIONES.map(s => (
                  <div key={s.id} style={{ display: 'contents' }}>
                    <div style={{ padding: '10px 12px', fontSize: 13, color: '#c8d0dc', borderBottom: '0.5px solid rgba(201,168,76,0.05)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <i className={`ti ${s.icon}`} style={{ color: 'var(--gold-dim)', fontSize: 14 }}></i>
                      {s.label}
                    </div>
                    {ROLES.map(r => (
                      <div key={`${s.id}-${r.value}`} style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '0.5px solid rgba(201,168,76,0.05)' }}>
                        {renderNivelCelda(r.value, s.id)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title"><i className="ti ti-info-circle"></i> Descripción de roles</div>
            </div>
            <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {DESCRIPCION_ROLES.map(d => {
                const meta = rolMeta(d.rol)
                return (
                  <div key={d.rol} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: meta.background, color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <i className={`ti ${meta.icon}`} style={{ fontSize: 16 }}></i>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: meta.color, fontWeight: 'bold' }}>{d.titulo}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginTop: 2 }}>{d.texto}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
