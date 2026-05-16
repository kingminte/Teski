import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import RutInput from '../components/RutInput'

const EMPTY_FORM = {
  nombre: '', apellido: '', rut: '',
  fecha_nacimiento: '', relacion: 'conyuge',
  estado: 'vigente', observaciones: '',
}

const ordenBeneficiarios = (a, b) => {
  const prioridad = { conyuge: 0, hijo: 1, padre: 2, madre: 3, hermano: 4, otro: 5 }
  return (prioridad[a.relacion] ?? 9) - (prioridad[b.relacion] ?? 9)
}

const RELACIONES = [
  { value: 'conyuge', label: 'Cónyuge' },
  { value: 'hijo', label: 'Hijo/a' },
  { value: 'padre', label: 'Padre' },
  { value: 'madre', label: 'Madre' },
  { value: 'hermano', label: 'Hermano/a' },
  { value: 'otro', label: 'Otro' },
]

export default function Beneficiarios() {
  const { socioId } = useParams()
  const navigate = useNavigate()
  const { showToast, ToastComponent } = useToast()
  const [socios, setSocios] = useState([])
  const [allBeneficiarios, setAllBeneficiarios] = useState([])
  const [panelAbierto, setPanelAbierto] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [selectedSocio, setSelectedSocio] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [rutValido, setRutValido] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    loadSocios()
    loadAllBeneficiarios()
  }, [])

  // Si viene con socioId en la URL, abrir ese panel
  useEffect(() => {
    if (socioId && socios.length > 0) {
      const s = socios.find(s => s.id === socioId)
      if (s) { setSelectedSocio(s); setPanelAbierto(socioId) }
    }
  }, [socioId, socios])

  const loadSocios = async () => {
    const { data } = await supabase.from('socios')
      .select('id,nombre,apellido,numero_socio,rut,estado')
      .order('numero_socio')
    setSocios(data || [])
  }

  const loadAllBeneficiarios = async () => {
    const { data } = await supabase.from('beneficiarios').select('*').order('socio_id')
    setAllBeneficiarios(data || [])
  }

  const togglePanel = (socio) => {
    if (panelAbierto === socio.id) {
      setPanelAbierto(null)
      setSelectedSocio(null)
    } else {
      setPanelAbierto(socio.id)
      setSelectedSocio(socio)
    }
  }

  const openNew = (socio) => {
    setSelectedSocio(socio)
    setForm(EMPTY_FORM)
    setEditId(null)
    setRutValido(false)
    setShowModal(true)
  }

  const openEdit = (b, socio) => {
    setSelectedSocio(socio)
    setForm({
      nombre: b.nombre, apellido: b.apellido, rut: b.rut,
      fecha_nacimiento: b.fecha_nacimiento || '',
      relacion: b.relacion, estado: b.estado,
      observaciones: b.observaciones || '',
    })
    setEditId(b.id)
    setRutValido(true)
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.nombre || !form.apellido || !form.rut) { showToast('Nombre, apellido y RUT son obligatorios', 'error'); return }
    if (!rutValido) { showToast('El RUT ingresado no es válido', 'error'); return }
    setSaving(true)
    const payload = { ...form, socio_id: selectedSocio.id }
    let error
    if (editId) {
      ;({ error } = await supabase.from('beneficiarios').update(form).eq('id', editId))
    } else {
      ;({ error } = await supabase.from('beneficiarios').insert(payload))
    }
    setSaving(false)
    if (error) showToast('Error al guardar beneficiario', 'error')
    else {
      showToast(editId ? 'Beneficiario actualizado' : 'Beneficiario agregado')
      setShowModal(false)
      loadAllBeneficiarios()
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este beneficiario?')) return
    const { error } = await supabase.from('beneficiarios').delete().eq('id', id)
    if (error) showToast('Error al eliminar', 'error')
    else { showToast('Beneficiario eliminado'); loadAllBeneficiarios() }
  }

  const handleExportar = async () => {
    setExportando(true)
    try {
      const XLSX = await import('xlsx')
      const { data: todosSocios } = await supabase.from('socios')
        .select('id,numero_socio,nombre,apellido,rut,email,estado').order('numero_socio')
      const { data: todosBeneficiarios } = await supabase.from('beneficiarios').select('*').order('socio_id')
      const relL = (v) => RELACIONES.find(r => r.value === v)?.label || v
      const rows = []

      for (const s of (todosSocios || [])) {
        const benes = (todosBeneficiarios || []).filter(b => b.socio_id === s.id).sort(ordenBeneficiarios)
        if (benes.length === 0) {
          // Socio sin beneficiarios — igual aparece en el Excel
          rows.push({
            'N° Socio': s.numero_socio,
            'Nombre socio': s.nombre,
            'Apellido socio': s.apellido,
            'RUT socio': s.rut,
            'Email': s.email || '',
            'Estado socio': s.estado,
            'Relación': '',
            'Nombre beneficiario': '',
            'Apellido beneficiario': '',
            'RUT beneficiario': '',
            'Fecha nacimiento': '',
            'Estado beneficiario': '',
          })
        } else {
          // Una fila por beneficiario, repitiendo datos del socio
          for (const b of benes) {
            rows.push({
              'N° Socio': s.numero_socio,
              'Nombre socio': s.nombre,
              'Apellido socio': s.apellido,
              'RUT socio': s.rut,
              'Email': s.email || '',
              'Estado socio': s.estado,
              'Relación': relL(b.relacion),
              'Nombre beneficiario': b.nombre,
              'Apellido beneficiario': b.apellido,
              'RUT beneficiario': b.rut,
              'Fecha nacimiento': b.fecha_nacimiento ? b.fecha_nacimiento.split('-').reverse().join('/') : '',
              'Estado beneficiario': b.estado,
            })
          }
        }
      }

      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [{wch:10},{wch:16},{wch:20},{wch:14},{wch:28},{wch:12},{wch:12},{wch:16},{wch:20},{wch:14},{wch:14},{wch:12}]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Socios y Beneficiarios')
      XLSX.writeFile(wb, 'Socios_y_Beneficiarios.xlsx')
      showToast('Excel exportado correctamente')
    } catch (e) { showToast('Error al exportar', 'error') }
    setExportando(false)
  }

  const F = (key) => ({ value: form[key] || '', onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) })
  const relLabel = (v) => RELACIONES.find(r => r.value === v)?.label || v

  // Filtrar socios
  const sociosFiltrados = socios.filter(s => {
    if (filtroEstado !== 'todos' && s.estado !== filtroEstado) return false
    if (!busqueda) return true
    const b = busqueda.toLowerCase()
    const enSocio = `${s.nombre} ${s.apellido} ${s.rut} ${s.numero_socio}`.toLowerCase().includes(b)
    const benesSocio = allBeneficiarios.filter(bene => bene.socio_id === s.id)
    const enBene = benesSocio.some(bene => `${bene.nombre} ${bene.apellido} ${bene.rut}`.toLowerCase().includes(b))
    return enSocio || enBene
  })

  const totalBenesFiltrados = sociosFiltrados.reduce((t, s) =>
    t + allBeneficiarios.filter(b => b.socio_id === s.id).length, 0)

  const initials = (nombre, apellido) => `${nombre?.[0] || ''}${apellido?.[0] || ''}`

  const AVATAR_COLORS = [
    { bg: 'rgba(83,74,183,0.3)', color: '#afa9ec' },
    { bg: 'rgba(29,158,117,0.2)', color: '#5dcaa5' },
    { bg: 'rgba(186,117,23,0.25)', color: '#fac775' },
    { bg: 'rgba(153,60,86,0.25)', color: '#ed93b1' },
    { bg: 'rgba(163,45,45,0.25)', color: '#f09595' },
  ]
  const avatarColor = (str) => {
    let hash = 0
    for (let i = 0; i < (str||'').length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
  }

  return (
    <div>
      {ToastComponent}

      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-users"></i> Socios y beneficiarios</div>
          <button className="btn" style={{ color: '#5dcaa5', borderColor: 'rgba(29,158,117,0.4)' }}
            onClick={handleExportar} disabled={exportando}>
            {exportando ? <><i className="ti ti-loader"></i> Exportando…</> : <><i className="ti ti-file-spreadsheet"></i> Exportar Excel</>}
          </button>
        </div>

        {/* Filtros */}
        <div style={{ padding: '0.75rem 1.25rem', borderBottom: '0.5px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Estado:</span>
          {['todos','activo','inactivo','pendiente'].map(f => (
            <button key={f} className={`btn btn-sm${filtroEstado === f ? ' btn-primary' : ''}`} onClick={() => setFiltroEstado(f)}>
              {f === 'todos' ? 'Todos' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <div className="search-box" style={{ marginLeft: 'auto' }}>
            <i className="ti ti-search"></i>
            <input placeholder="Buscar socio o beneficiario…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
          </div>
        </div>

        <div style={{ padding: '0.4rem 1.25rem', borderBottom: '0.5px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
          Mostrando <strong style={{ color: 'var(--text)' }}>{sociosFiltrados.length}</strong> socios · <strong style={{ color: 'var(--text)' }}>{totalBenesFiltrados}</strong> beneficiarios
        </div>

        {sociosFiltrados.length === 0 ? (
          <div className="empty-state"><i className="ti ti-users-off"></i>Sin resultados</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>N° Socio</th><th>Nombre</th><th>Apellido</th>
                <th>RUT</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sociosFiltrados.map(s => {
                const benes = allBeneficiarios.filter(b => b.socio_id === s.id).sort(ordenBeneficiarios)
                const abierto = panelAbierto === s.id
                const ac = avatarColor(s.nombre)

                return (
                  <React.Fragment key={s.id}>
                    <tr style={{ background: 'rgba(10,22,40,0.3)' }}>
                      <td><span className="chip">{s.numero_socio}</span></td>
                      <td style={{ fontWeight: 'bold' }}>{s.nombre}</td>
                      <td style={{ fontWeight: 'bold' }}>{s.apellido}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.rut}</td>
                      <td>
                        {s.estado === 'activo' && <span className="badge badge-active">Activo</span>}
                        {s.estado === 'inactivo' && <span className="badge badge-inactive">Inactivo</span>}
                        {s.estado === 'pendiente' && <span className="badge badge-pending">Pendiente</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)', marginRight: 8, fontFamily: 'sans-serif' }}>
                          {benes.length} beneficiario{benes.length !== 1 ? 's' : ''}
                        </span>
                        <button className={`btn btn-sm${abierto ? '' : ' btn-primary'}`} onClick={() => togglePanel(s)}>
                          <i className={`ti ${abierto ? 'ti-chevron-up' : 'ti-layout-sidebar-right-expand'}`}></i>
                          {abierto ? 'Cerrar' : 'Gestionar'}
                        </button>
                      </td>
                    </tr>

                    {/* Panel de gestión */}
                    {abierto && (
                      <tr key={`panel-${s.id}`}>
                        <td colSpan={6} style={{ padding: 0, background: 'rgba(10,22,40,0.5)' }}>
                          {/* Header del socio */}
                          <div style={{ padding: '1rem 1.5rem', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div className="avatar" style={{ width: 42, height: 42, background: ac.bg, color: ac.color, fontSize: 15 }}>
                                {initials(s.nombre, s.apellido)}
                              </div>
                              <div>
                                <div style={{ fontSize: 14, fontWeight: 'bold', color: 'var(--gold-light)' }}>{s.nombre} {s.apellido}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>{s.numero_socio} · {s.rut}</div>
                              </div>
                            </div>
                            <button className="btn btn-primary btn-sm" onClick={() => openNew(s)}>
                              <i className="ti ti-plus"></i> Agregar beneficiario
                            </button>
                          </div>

                          {/* Lista de beneficiarios */}
                          {benes.length === 0 ? (
                            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'sans-serif', fontSize: 13 }}>
                              <i className="ti ti-heart-off" style={{ fontSize: 24, display: 'block', marginBottom: 8 }}></i>
                              Sin beneficiarios registrados
                            </div>
                          ) : (
                            benes.map(b => {
                              const bc = avatarColor(b.nombre)
                              return (
                                <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1.5rem', borderBottom: '0.5px solid rgba(201,168,76,0.06)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div className="avatar" style={{ width: 34, height: 34, background: bc.bg, color: bc.color, fontSize: 12 }}>
                                      {initials(b.nombre, b.apellido)}
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 13, color: '#c8d0dc' }}>{b.nombre} {b.apellido}</div>
                                      <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
                                        {b.rut}
                                        {b.fecha_nacimiento && ` · ${b.fecha_nacimiento.split('-').reverse().join('/')}`}
                                      </div>
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{
                                      display: 'inline-flex', padding: '2px 8px', borderRadius: 4,
                                      fontSize: 11, fontFamily: 'sans-serif',
                                      background: b.relacion === 'conyuge' ? 'rgba(55,138,221,0.15)' : 'rgba(239,159,39,0.15)',
                                      color: b.relacion === 'conyuge' ? '#85b7eb' : '#fac775',
                                    }}>{relLabel(b.relacion)}</span>
                                    <span className={`badge ${b.estado === 'vigente' ? 'badge-active' : 'badge-inactive'}`}>
                                      {b.estado === 'vigente' ? 'Vigente' : 'Inactivo'}
                                    </span>
                                    {b.estado === 'inactivo' && b.estado_previo && (
                                      <span style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic', marginLeft: 6, fontFamily: 'sans-serif' }}>
                                        (por socio inactivo)
                                      </span>
                                    )}
                                    <button className="btn btn-sm" onClick={() => openEdit(b, s)}>
                                      <i className="ti ti-edit"></i>
                                    </button>
                                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(b.id)}>
                                      <i className="ti ti-trash"></i>
                                    </button>
                                  </div>
                                </div>
                              )
                            })
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal agregar/editar */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">
                {editId ? 'Editar beneficiario' : `Agregar beneficiario — ${selectedSocio?.nombre} ${selectedSocio?.apellido}`}
              </div>
              <button className="btn btn-sm" onClick={() => setShowModal(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Nombre *</label><input placeholder="Nombre" {...F('nombre')} /></div>
              <div className="form-group"><label>Apellido *</label><input placeholder="Apellido" {...F('apellido')} /></div>
              <div className="form-group">
                <label>RUT *</label>
                <RutInput value={form.rut}
                  onChange={val => setForm(f => ({ ...f, rut: val }))}
                  onValidChange={(valido, formateado) => { setRutValido(valido); if (valido) setForm(f => ({ ...f, rut: formateado })) }}
                  required />
              </div>
              <div className="form-group"><label>Fecha de nacimiento</label><input type="date" {...F('fecha_nacimiento')} /></div>
              <div className="form-group">
                <label>Relación</label>
                <select {...F('relacion')}>{RELACIONES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
              </div>
              <div className="form-group">
                <label>Estado</label>
                <select {...F('estado')}><option value="vigente">Vigente</option><option value="inactivo">Inactivo</option></select>
              </div>
              <div className="form-group full"><label>Observaciones</label><input placeholder="Notas adicionales (opcional)" {...F('observaciones')} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editId ? 'Guardar cambios' : 'Agregar'}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
