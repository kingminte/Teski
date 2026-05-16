import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import { useBancos } from '../lib/useBancos'
import RutInput from '../components/RutInput'

const BANCOS_INICIALES = [
  'Banco Estado', 'BCI', 'Santander', 'Scotiabank', 'Falabella',
  'Itaú', 'Security', 'BICE', 'Consorcio', 'Ripley',
  'Internacional', 'BTG Pactual', 'Coopeuch', 'HSBC', 'Banco de Chile'
]

const TIPOS_CUENTA = ['Cuenta corriente', 'Cuenta vista', 'Cuenta ahorro']

const CONFIG_KEYS = {
  banco_nombre: 'Santander',
  banco_tipo_cuenta: 'Cuenta corriente',
  banco_numero_cuenta: '',
  banco_rut: '',
  banco_titular: '',
  banco_email: '',
  club_nombre: 'Teski Club',
  club_direccion: '',
  club_telefono: '',
}

export default function Bancos() {
  const { showToast, ToastComponent } = useToast()
  const { puedeEditar } = useAuth()
  const editable = puedeEditar('configuracion')
  const { bancos: bancosActivos } = useBancos()
  const [tab, setTab] = useState('bancos')

  // --- Tab Bancos ---
  const [bancos, setBancos] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ nombre: '', descripcion: '', activo: true })
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [iniciando, setIniciando] = useState(false)

  // --- Tab Config Club ---
  const [configForm, setConfigForm] = useState({ ...CONFIG_KEYS })
  const [configLoading, setConfigLoading] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [rutValido, setRutValido] = useState(true)

  // --- Tab Plan de cuentas ---
  const [cuentas, setCuentas] = useState([])
  const [cuentasLoading, setCuentasLoading] = useState(false)
  const [showModalCuenta, setShowModalCuenta] = useState(false)
  const [formCuenta, setFormCuenta] = useState({ nombre: '', tipo: 'ingreso', descripcion: '' })
  const [editCuentaId, setEditCuentaId] = useState(null)
  const [savingCuenta, setSavingCuenta] = useState(false)
  const [filtroCuentaTipo, setFiltroCuentaTipo] = useState('todos')

  // --- Tab Proveedores ---
  const EMPTY_PROVEEDOR = { nombre: '', rut: '', tipo: 'empresa', giro: '', direccion: '', telefono: '', email: '', contacto: '', activo: true }
  const [proveedores, setProveedores] = useState([])
  const [proveedoresLoading, setProveedoresLoading] = useState(false)
  const [showModalProveedor, setShowModalProveedor] = useState(false)
  const [formProveedor, setFormProveedor] = useState(EMPTY_PROVEEDOR)
  const [editProveedorId, setEditProveedorId] = useState(null)
  const [savingProveedor, setSavingProveedor] = useState(false)
  const [filtroProveedorActivo, setFiltroProveedorActivo] = useState('todos')
  const [busquedaProveedor, setBusquedaProveedor] = useState('')

  useEffect(() => { load(); loadConfig(); loadCuentas(); loadProveedores() }, [])

  // Bancos
  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('bancos').select('*').order('nombre')
    setBancos(data || [])
    setLoading(false)
  }

  const handleInicializar = async () => {
    setIniciando(true)
    const existentes = bancos.map(b => b.nombre.toLowerCase())
    const nuevos = BANCOS_INICIALES.filter(b => !existentes.includes(b.toLowerCase()))
    if (nuevos.length === 0) { showToast('Todos los bancos ya están registrados'); setIniciando(false); return }
    const { error } = await supabase.from('bancos').insert(nuevos.map(n => ({ nombre: n, activo: true })))
    if (error) showToast('Error al inicializar bancos', 'error')
    else { showToast(`${nuevos.length} bancos agregados`); load() }
    setIniciando(false)
  }

  const openNew = () => { setForm({ nombre: '', descripcion: '', activo: true }); setEditId(null); setShowModal(true) }
  const openEdit = (b) => { setForm({ nombre: b.nombre, descripcion: b.descripcion || '', activo: b.activo }); setEditId(b.id); setShowModal(true) }

  const handleSave = async () => {
    if (!form.nombre.trim()) { showToast('El nombre es obligatorio', 'error'); return }
    setSaving(true)
    let error
    if (editId) { ;({ error } = await supabase.from('bancos').update(form).eq('id', editId)) }
    else { ;({ error } = await supabase.from('bancos').insert(form)) }
    setSaving(false)
    if (error) showToast(error.message.includes('unique') ? 'Ese banco ya existe' : 'Error al guardar', 'error')
    else { showToast(editId ? 'Banco actualizado' : 'Banco agregado'); setShowModal(false); load() }
  }

  const handleToggleActivo = async (id, activo) => { await supabase.from('bancos').update({ activo: !activo }).eq('id', id); load() }
  const handleDelete = async (id) => { if (!confirm('¿Eliminar este banco?')) return; await supabase.from('bancos').delete().eq('id', id); load() }

  const filtrados = bancos.filter(b => b.nombre.toLowerCase().includes(search.toLowerCase()))
  const activos = filtrados.filter(b => b.activo).length

  // Config Club
  const loadConfig = async () => {
    setConfigLoading(true)
    const { data } = await supabase.from('config_club').select('*')
    if (data) {
      const config = { ...CONFIG_KEYS }
      data.forEach(r => { if (r.clave in config) config[r.clave] = r.valor })
      setConfigForm(config)
    }
    setConfigLoading(false)
  }

  const handleSaveConfig = async () => {
    setConfigSaving(true)
    let errCount = 0
    for (const [clave, valor] of Object.entries(configForm)) {
      // Intentar update primero, si no existe hacer insert
      const { data: existing } = await supabase.from('config_club').select('id').eq('clave', clave).maybeSingle()
      let error
      if (existing) {
        ;({ error } = await supabase.from('config_club').update({ valor: valor || '' }).eq('clave', clave))
      } else {
        ;({ error } = await supabase.from('config_club').insert({ clave, valor: valor || '' }))
      }
      if (error) { console.error('Error guardando', clave, error); errCount++ }
    }
    if (errCount > 0) showToast(`Error al guardar ${errCount} campo(s)`, 'error')
    else showToast('Configuración guardada correctamente')
    setConfigSaving(false)
    loadConfig()
  }

  const CF = (key) => ({
    value: configForm[key] || '',
    onChange: e => setConfigForm(f => ({ ...f, [key]: e.target.value })),
  })

  // Plan de cuentas
  const loadCuentas = async () => {
    setCuentasLoading(true)
    const { data } = await supabase.from('plan_cuentas').select('*').order('tipo').order('nombre')
    setCuentas(data || [])
    setCuentasLoading(false)
  }

  const openNewCuenta = () => {
    setFormCuenta({ nombre: '', tipo: 'ingreso', descripcion: '' })
    setEditCuentaId(null)
    setShowModalCuenta(true)
  }

  const openEditCuenta = (c) => {
    setFormCuenta({ nombre: c.nombre, tipo: c.tipo, descripcion: c.descripcion || '' })
    setEditCuentaId(c.id)
    setShowModalCuenta(true)
  }

  const handleSaveCuenta = async () => {
    if (!formCuenta.nombre.trim()) { showToast('El nombre es obligatorio', 'error'); return }
    setSavingCuenta(true)
    let error
    if (editCuentaId) {
      ;({ error } = await supabase.from('plan_cuentas').update(formCuenta).eq('id', editCuentaId))
    } else {
      ;({ error } = await supabase.from('plan_cuentas').insert(formCuenta))
    }
    setSavingCuenta(false)
    if (error) showToast('Error al guardar', 'error')
    else { showToast(editCuentaId ? 'Cuenta actualizada' : 'Cuenta creada'); setShowModalCuenta(false); loadCuentas() }
  }

  const handleToggleCuenta = async (id, activo) => {
    await supabase.from('plan_cuentas').update({ activo: !activo }).eq('id', id)
    loadCuentas()
  }

  const handleDeleteCuenta = async (id) => {
    if (!confirm('¿Eliminar esta cuenta?')) return
    const { error } = await supabase.from('plan_cuentas').delete().eq('id', id)
    if (error) showToast('Error al eliminar', 'error')
    else { showToast('Cuenta eliminada'); loadCuentas() }
  }

  const cuentasFiltradas = cuentas.filter(c => filtroCuentaTipo === 'todos' || c.tipo === filtroCuentaTipo)
  const totalIngresos = cuentas.filter(c => c.tipo === 'ingreso').length
  const totalGastos = cuentas.filter(c => c.tipo === 'gasto').length

  // Proveedores
  const loadProveedores = async () => {
    setProveedoresLoading(true)
    const { data } = await supabase.from('proveedores').select('*').order('nombre')
    setProveedores(data || [])
    setProveedoresLoading(false)
  }

  const openNewProveedor = () => {
    setFormProveedor(EMPTY_PROVEEDOR)
    setEditProveedorId(null)
    setShowModalProveedor(true)
  }

  const openEditProveedor = (p) => {
    setFormProveedor({
      nombre: p.nombre || '',
      rut: p.rut || '',
      tipo: p.tipo || 'empresa',
      giro: p.giro || '',
      direccion: p.direccion || '',
      telefono: p.telefono || '',
      email: p.email || '',
      contacto: p.contacto || '',
      activo: p.activo,
    })
    setEditProveedorId(p.id)
    setShowModalProveedor(true)
  }

  const handleSaveProveedor = async () => {
    if (!formProveedor.nombre.trim()) { showToast('El nombre es obligatorio', 'error'); return }
    setSavingProveedor(true)
    let error
    if (editProveedorId) {
      ;({ error } = await supabase.from('proveedores').update(formProveedor).eq('id', editProveedorId))
    } else {
      ;({ error } = await supabase.from('proveedores').insert(formProveedor))
    }
    setSavingProveedor(false)
    if (error) showToast('Error al guardar', 'error')
    else { showToast(editProveedorId ? 'Proveedor actualizado' : 'Proveedor creado'); setShowModalProveedor(false); loadProveedores() }
  }

  const handleToggleProveedor = async (id, activo) => {
    await supabase.from('proveedores').update({ activo: !activo }).eq('id', id)
    loadProveedores()
  }

  const handleDeleteProveedor = async (id) => {
    if (!confirm('¿Eliminar este proveedor? Si tiene cuentas por pagar asociadas, esas quedarán sin proveedor.')) return
    const { error } = await supabase.from('proveedores').delete().eq('id', id)
    if (error) showToast('Error al eliminar', 'error')
    else { showToast('Proveedor eliminado'); loadProveedores() }
  }

  const proveedoresFiltrados = proveedores.filter(p => {
    if (filtroProveedorActivo === 'activo' && !p.activo) return false
    if (filtroProveedorActivo === 'inactivo' && p.activo) return false
    const q = busquedaProveedor.toLowerCase().trim()
    if (q && !`${p.nombre} ${p.rut || ''} ${p.giro || ''}`.toLowerCase().includes(q)) return false
    return true
  })
  const proveedoresActivos = proveedores.filter(p => p.activo).length
  const proveedoresInactivos = proveedores.length - proveedoresActivos

  return (
    <div>
      {ToastComponent}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', marginBottom: '1.5rem' }}>
        {[
          { id: 'bancos', icon: 'ti-building-bank', label: 'Bancos' },
          { id: 'config', icon: 'ti-settings', label: 'Datos del club' },
          { id: 'plan_cuentas', icon: 'ti-list-tree', label: 'Plan de cuentas' },
          { id: 'proveedores', icon: 'ti-truck', label: 'Proveedores' },
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

      {/* ============ TAB BANCOS ============ */}
      {tab === 'bancos' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: '1.5rem' }}>
            {[
              { label: 'Total bancos', value: bancos.length, color: 'var(--gold-light)' },
              { label: 'Activos', value: activos, color: '#5dcaa5' },
              { label: 'Inactivos', value: bancos.length - activos, color: 'var(--text-muted)' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title"><i className="ti ti-building-bank"></i> Bancos registrados</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="search-box">
                  <i className="ti ti-search"></i>
                  <input placeholder="Buscar banco…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                {bancos.length === 0 && (
                  <button className="btn btn-sm" onClick={handleInicializar} disabled={iniciando}>
                    {iniciando ? <><i className="ti ti-loader"></i> Cargando…</> : <><i className="ti ti-download"></i> Cargar lista base</>}
                  </button>
                )}
                {editable && (
                  <button className="btn btn-primary btn-sm" onClick={openNew}>
                    <i className="ti ti-plus"></i> Nuevo banco
                  </button>
                )}
              </div>
            </div>
            {loading ? (
              <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
            ) : filtrados.length === 0 ? (
              <div className="empty-state">
                <i className="ti ti-building-bank"></i>
                {bancos.length === 0 ? 'No hay bancos registrados.' : 'Sin resultados'}
              </div>
            ) : (
              <table>
                <thead><tr><th>Nombre</th><th>Descripción</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                  {filtrados.map(b => (
                    <tr key={b.id}>
                      <td style={{ color: b.activo ? '#c8d0dc' : 'var(--text-dim)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <i className="ti ti-building-bank" style={{ color: b.activo ? 'var(--gold-dim)' : 'var(--text-dim)', fontSize: 15 }}></i>
                          {b.nombre}
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{b.descripcion || '—'}</td>
                      <td>{b.activo ? <span className="badge badge-active">Activo</span> : <span className="badge badge-inactive">Inactivo</span>}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => openEdit(b)}><i className="ti ti-edit"></i></button>
                          <button className="btn btn-sm" onClick={() => handleToggleActivo(b.id, b.activo)} title={b.activo ? 'Desactivar' : 'Activar'}>
                            <i className={`ti ${b.activo ? 'ti-eye-off' : 'ti-eye'}`}></i>
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDelete(b.id)}><i className="ti ti-trash"></i></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {showModal && (
            <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
              <div className="modal" style={{ width: 420 }}>
                <div className="modal-header">
                  <div className="modal-title">{editId ? 'Editar banco' : 'Nuevo banco'}</div>
                  <button className="btn btn-sm" onClick={() => setShowModal(false)}><i className="ti ti-x"></i></button>
                </div>
                <div className="form-grid">
                  <div className="form-group full"><label>Nombre *</label>
                    <input placeholder="Ej: Banco de Chile" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
                  </div>
                  <div className="form-group full"><label>Descripción (opcional)</label>
                    <input placeholder="Notas" value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
                  </div>
                  <div className="form-group full"><label>Estado</label>
                    <select value={form.activo ? 'activo' : 'inactivo'} onChange={e => setForm(f => ({ ...f, activo: e.target.value === 'activo' }))}>
                      <option value="activo">Activo</option><option value="inactivo">Inactivo</option>
                    </select>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn" onClick={() => setShowModal(false)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editId ? 'Guardar cambios' : 'Agregar banco'}</>}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ============ TAB DATOS DEL CLUB ============ */}
      {tab === 'config' && (
        configLoading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando configuración…</div>
        ) : (
          <>
            {/* Datos bancarios */}
            <div className="card">
              <div className="card-header">
                <div className="card-title"><i className="ti ti-credit-card"></i> Datos bancarios del club</div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                  Estos datos se usan en los emails de cobranza y referencias de pago
                </span>
              </div>
              <div style={{ padding: '1.25rem' }}>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Banco</label>
                    <select value={configForm.banco_nombre} onChange={e => setConfigForm(f => ({ ...f, banco_nombre: e.target.value }))}>
                      <option value="">Seleccionar banco…</option>
                      {bancosActivos.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Tipo de cuenta</label>
                    <select value={configForm.banco_tipo_cuenta} onChange={e => setConfigForm(f => ({ ...f, banco_tipo_cuenta: e.target.value }))}>
                      {TIPOS_CUENTA.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>N° de cuenta</label>
                    <input placeholder="Ej: 0-082-66-00910-1" {...CF('banco_numero_cuenta')} />
                  </div>
                  <div className="form-group">
                    <label>RUT titular</label>
                    <RutInput
                      value={configForm.banco_rut}
                      onChange={val => setConfigForm(f => ({ ...f, banco_rut: val }))}
                      onValidChange={(valido, formateado) => {
                        setRutValido(valido)
                        if (valido) setConfigForm(f => ({ ...f, banco_rut: formateado }))
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label>Nombre titular</label>
                    <input placeholder="Ej: Teski Club" {...CF('banco_titular')} />
                  </div>
                  <div className="form-group">
                    <label>Email notificación</label>
                    <input type="email" placeholder="Ej: tesoreria@teski.cl" {...CF('banco_email')} />
                  </div>
                </div>
              </div>
            </div>

            {/* Vista previa datos bancarios */}
            <div className="card">
              <div className="card-header">
                <div className="card-title"><i className="ti ti-eye"></i> Vista previa — datos para transferencia</div>
              </div>
              <div style={{ padding: '1.25rem' }}>
                <div style={{ background: 'var(--navy-mid)', borderRadius: 8, padding: '1rem 1.25rem', fontFamily: 'sans-serif', fontSize: 13, lineHeight: 1.8 }}>
                  <div style={{ color: 'var(--text-muted)' }}>Banco: <strong style={{ color: 'var(--gold-light)' }}>{configForm.banco_nombre || '—'}</strong></div>
                  <div style={{ color: 'var(--text-muted)' }}>Tipo: <strong style={{ color: '#c8d0dc' }}>{configForm.banco_tipo_cuenta || '—'}</strong></div>
                  <div style={{ color: 'var(--text-muted)' }}>N° cuenta: <strong style={{ color: '#c8d0dc', fontFamily: 'monospace' }}>{configForm.banco_numero_cuenta || '—'}</strong></div>
                  <div style={{ color: 'var(--text-muted)' }}>RUT: <strong style={{ color: '#c8d0dc', fontFamily: 'monospace' }}>{configForm.banco_rut || '—'}</strong></div>
                  <div style={{ color: 'var(--text-muted)' }}>Titular: <strong style={{ color: '#c8d0dc' }}>{configForm.banco_titular || '—'}</strong></div>
                  <div style={{ color: 'var(--text-muted)' }}>Email: <strong style={{ color: '#85b7eb' }}>{configForm.banco_email || '—'}</strong></div>
                </div>
              </div>
            </div>

            {/* Información del club */}
            <div className="card">
              <div className="card-header">
                <div className="card-title"><i className="ti ti-home"></i> Información del club</div>
              </div>
              <div style={{ padding: '1.25rem' }}>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Nombre del club</label>
                    <input placeholder="Ej: Teski Club" {...CF('club_nombre')} />
                  </div>
                  <div className="form-group">
                    <label>Teléfono</label>
                    <input placeholder="Ej: +56 9 1234 5678" {...CF('club_telefono')} />
                  </div>
                  <div className="form-group full">
                    <label>Dirección</label>
                    <input placeholder="Ej: Av. Principal 123, Puerto Varas" {...CF('club_direccion')} />
                  </div>
                </div>
              </div>
            </div>

            {/* Botón guardar */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button className="btn btn-primary" onClick={handleSaveConfig} disabled={configSaving} style={{ padding: '8px 24px', fontSize: 14 }}>
                {configSaving
                  ? <><i className="ti ti-loader"></i> Guardando…</>
                  : <><i className="ti ti-device-floppy"></i> Guardar cambios</>}
              </button>
            </div>
          </>
        )
      )}

      {/* ============ TAB PLAN DE CUENTAS ============ */}
      {tab === 'plan_cuentas' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: '1.5rem' }}>
            {[
              { label: 'Total cuentas', value: cuentas.length, color: 'var(--gold-light)' },
              { label: 'Ingresos', value: totalIngresos, color: '#5dcaa5' },
              { label: 'Gastos', value: totalGastos, color: '#f09595' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title"><i className="ti ti-list-tree"></i> Plan de cuentas</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    { id: 'todos', label: 'Todos' },
                    { id: 'ingreso', label: 'Ingresos' },
                    { id: 'gasto', label: 'Gastos' },
                  ].map(f => (
                    <button key={f.id} className={`btn btn-sm${filtroCuentaTipo === f.id ? ' btn-primary' : ''}`} onClick={() => setFiltroCuentaTipo(f.id)}>
                      {f.label}
                    </button>
                  ))}
                </div>
                {editable && (
                  <button className="btn btn-primary btn-sm" onClick={openNewCuenta}>
                    <i className="ti ti-plus"></i> Nueva cuenta
                  </button>
                )}
              </div>
            </div>
            {cuentasLoading ? (
              <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
            ) : cuentasFiltradas.length === 0 ? (
              <div className="empty-state">
                <i className="ti ti-list-tree"></i>
                {cuentas.length === 0 ? 'No hay cuentas registradas.' : 'Sin resultados con este filtro'}
              </div>
            ) : (
              <table>
                <thead><tr><th>Nombre</th><th>Tipo</th><th>Descripción</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                  {cuentasFiltradas.map(c => (
                    <tr key={c.id}>
                      <td style={{ color: c.activo ? '#c8d0dc' : 'var(--text-dim)' }}>{c.nombre}</td>
                      <td>
                        {c.tipo === 'ingreso' ? (
                          <span className="badge" style={{ background: 'rgba(29,158,117,0.15)', color: '#5dcaa5', border: '0.5px solid rgba(29,158,117,0.3)' }}>
                            <i className="ti ti-arrow-down-left" style={{ fontSize: 11, marginRight: 4 }}></i>Ingreso
                          </span>
                        ) : (
                          <span className="badge" style={{ background: 'rgba(240,149,149,0.15)', color: '#f09595', border: '0.5px solid rgba(240,149,149,0.3)' }}>
                            <i className="ti ti-arrow-up-right" style={{ fontSize: 11, marginRight: 4 }}></i>Gasto
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{c.descripcion || '—'}</td>
                      <td>{c.activo ? <span className="badge badge-active">Activo</span> : <span className="badge badge-inactive">Inactivo</span>}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => openEditCuenta(c)} title="Editar"><i className="ti ti-edit"></i></button>
                          <button className="btn btn-sm" onClick={() => handleToggleCuenta(c.id, c.activo)} title={c.activo ? 'Desactivar' : 'Activar'}>
                            <i className={`ti ${c.activo ? 'ti-eye-off' : 'ti-eye'}`}></i>
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteCuenta(c.id)} title="Eliminar"><i className="ti ti-trash"></i></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {showModalCuenta && (
            <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModalCuenta(false)}>
              <div className="modal" style={{ width: 460 }}>
                <div className="modal-header">
                  <div className="modal-title">{editCuentaId ? 'Editar cuenta' : 'Nueva cuenta'}</div>
                  <button className="btn btn-sm" onClick={() => setShowModalCuenta(false)}><i className="ti ti-x"></i></button>
                </div>
                <div className="form-grid">
                  <div className="form-group full"><label>Nombre *</label>
                    <input placeholder="Ej: Cuota social" value={formCuenta.nombre} onChange={e => setFormCuenta(f => ({ ...f, nombre: e.target.value }))} />
                  </div>
                  <div className="form-group full"><label>Tipo</label>
                    <select value={formCuenta.tipo} onChange={e => setFormCuenta(f => ({ ...f, tipo: e.target.value }))}>
                      <option value="ingreso">Ingreso</option>
                      <option value="gasto">Gasto</option>
                    </select>
                  </div>
                  <div className="form-group full"><label>Descripción (opcional)</label>
                    <input placeholder="Para qué se usa esta cuenta" value={formCuenta.descripcion} onChange={e => setFormCuenta(f => ({ ...f, descripcion: e.target.value }))} />
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn" onClick={() => setShowModalCuenta(false)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={handleSaveCuenta} disabled={savingCuenta}>
                    {savingCuenta ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editCuentaId ? 'Guardar cambios' : 'Crear cuenta'}</>}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ============ TAB PROVEEDORES ============ */}
      {tab === 'proveedores' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: '1.5rem' }}>
            {[
              { label: 'Total proveedores', value: proveedores.length, color: 'var(--gold-light)' },
              { label: 'Activos', value: proveedoresActivos, color: '#5dcaa5' },
              { label: 'Inactivos', value: proveedoresInactivos, color: 'var(--text-muted)' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title"><i className="ti ti-truck"></i> Proveedores</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    { id: 'todos', label: 'Todos' },
                    { id: 'activo', label: 'Activos' },
                    { id: 'inactivo', label: 'Inactivos' },
                  ].map(f => (
                    <button key={f.id} className={`btn btn-sm${filtroProveedorActivo === f.id ? ' btn-primary' : ''}`} onClick={() => setFiltroProveedorActivo(f.id)}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="search-box">
                  <i className="ti ti-search"></i>
                  <input placeholder="Buscar nombre / RUT / giro…" value={busquedaProveedor} onChange={e => setBusquedaProveedor(e.target.value)} />
                </div>
                {editable && <button className="btn btn-primary btn-sm" onClick={openNewProveedor}>
                  <i className="ti ti-plus"></i> Nuevo proveedor
                </button>}
              </div>
            </div>
            {proveedoresLoading ? (
              <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
            ) : proveedoresFiltrados.length === 0 ? (
              <div className="empty-state">
                <i className="ti ti-truck"></i>
                {proveedores.length === 0 ? 'No hay proveedores registrados.' : 'Sin resultados con este filtro'}
              </div>
            ) : (
              <table>
                <thead><tr><th>Nombre</th><th>RUT</th><th>Tipo</th><th>Giro</th><th>Contacto</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                  {proveedoresFiltrados.map(p => (
                    <tr key={p.id}>
                      <td style={{ color: p.activo ? '#c8d0dc' : 'var(--text-dim)' }}>
                        <div>{p.nombre}</div>
                        {p.email && <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>{p.email}</div>}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{p.rut || '—'}</td>
                      <td>
                        {p.tipo === 'empresa' ? (
                          <span className="badge" style={{ background: 'rgba(55,138,221,0.15)', color: '#85b7eb', border: '0.5px solid rgba(55,138,221,0.3)' }}>
                            <i className="ti ti-building" style={{ fontSize: 11, marginRight: 4 }}></i>Empresa
                          </span>
                        ) : (
                          <span className="badge" style={{ background: 'rgba(29,158,117,0.15)', color: '#5dcaa5', border: '0.5px solid rgba(29,158,117,0.3)' }}>
                            <i className="ti ti-user" style={{ fontSize: 11, marginRight: 4 }}></i>Persona
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.giro || '—'}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        <div>{p.contacto || '—'}</div>
                        {p.telefono && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{p.telefono}</div>}
                      </td>
                      <td>{p.activo ? <span className="badge badge-active">Activo</span> : <span className="badge badge-inactive">Inactivo</span>}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => openEditProveedor(p)} title="Editar"><i className="ti ti-edit"></i></button>
                          <button className="btn btn-sm" onClick={() => handleToggleProveedor(p.id, p.activo)} title={p.activo ? 'Desactivar' : 'Activar'}>
                            <i className={`ti ${p.activo ? 'ti-eye-off' : 'ti-eye'}`}></i>
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteProveedor(p.id)} title="Eliminar"><i className="ti ti-trash"></i></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {showModalProveedor && (
            <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModalProveedor(false)}>
              <div className="modal" style={{ width: 580 }}>
                <div className="modal-header">
                  <div className="modal-title">{editProveedorId ? 'Editar proveedor' : 'Nuevo proveedor'}</div>
                  <button className="btn btn-sm" onClick={() => setShowModalProveedor(false)}><i className="ti ti-x"></i></button>
                </div>
                <div className="form-grid">
                  <div className="form-group full"><label>Nombre *</label>
                    <input placeholder="Ej: Distribuidora ABC" value={formProveedor.nombre} onChange={e => setFormProveedor(f => ({ ...f, nombre: e.target.value }))} />
                  </div>
                  <div className="form-group"><label>RUT</label>
                    <RutInput
                      value={formProveedor.rut}
                      onChange={val => setFormProveedor(f => ({ ...f, rut: val }))}
                      onValidChange={(valido, formateado) => { if (valido) setFormProveedor(f => ({ ...f, rut: formateado })) }}
                    />
                  </div>
                  <div className="form-group"><label>Tipo</label>
                    <select value={formProveedor.tipo} onChange={e => setFormProveedor(f => ({ ...f, tipo: e.target.value }))}>
                      <option value="empresa">Empresa</option>
                      <option value="persona">Persona</option>
                    </select>
                  </div>
                  <div className="form-group"><label>Giro</label>
                    <input placeholder="Ej: Mantención industrial" value={formProveedor.giro} onChange={e => setFormProveedor(f => ({ ...f, giro: e.target.value }))} />
                  </div>
                  <div className="form-group"><label>Teléfono</label>
                    <input placeholder="+56 9 1234 5678" value={formProveedor.telefono} onChange={e => setFormProveedor(f => ({ ...f, telefono: e.target.value }))} />
                  </div>
                  <div className="form-group full"><label>Dirección</label>
                    <input placeholder="Calle 123, Ciudad" value={formProveedor.direccion} onChange={e => setFormProveedor(f => ({ ...f, direccion: e.target.value }))} />
                  </div>
                  <div className="form-group"><label>Email</label>
                    <input type="email" placeholder="contacto@proveedor.cl" value={formProveedor.email} onChange={e => setFormProveedor(f => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div className="form-group"><label>Contacto</label>
                    <input placeholder="Nombre del contacto" value={formProveedor.contacto} onChange={e => setFormProveedor(f => ({ ...f, contacto: e.target.value }))} />
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn" onClick={() => setShowModalProveedor(false)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={handleSaveProveedor} disabled={savingProveedor}>
                    {savingProveedor ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editProveedorId ? 'Guardar cambios' : 'Crear proveedor'}</>}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
