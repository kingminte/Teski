import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import { formatearMontoConSimbolo, parsearMonto, formatearMonto } from '../lib/montos'

const EMPTY = { concepto: '', descripcion: '', monto: '', fecha: '', origen: 'manual', archivo: null }
const hoyStr = () => new Date().toISOString().slice(0, 10)

const origenBadge = (origen) => {
  if (origen === 'cartola') return (
    <span className="badge" style={{ background: 'rgba(29,158,117,0.15)', color: '#5dcaa5', border: '0.5px solid rgba(29,158,117,0.3)' }}>
      <i className="ti ti-link" style={{ fontSize: 10, marginRight: 3 }}></i>Cartola
    </span>
  )
  if (origen === 'efectivo') return (
    <span className="badge" style={{ background: 'rgba(239,159,39,0.15)', color: '#fac775', border: '0.5px solid rgba(239,159,39,0.3)' }}>
      <i className="ti ti-cash" style={{ fontSize: 10, marginRight: 3 }}></i>Efectivo
    </span>
  )
  return (
    <span className="badge badge-pending">
      <i className="ti ti-pencil" style={{ fontSize: 10, marginRight: 3 }}></i>Manual
    </span>
  )
}

export default function OtrosIngresos() {
  const { showToast, ToastComponent } = useToast()
  const { puedeEditar } = useAuth()
  const editable = puedeEditar('otros_ingresos')

  const [ingresos, setIngresos] = useState([])
  const [planCuentas, setPlanCuentas] = useState([])
  const [loading, setLoading] = useState(true)
  const [anioFiltro, setAnioFiltro] = useState(new Date().getFullYear().toString())
  const [origenFiltro, setOrigenFiltro] = useState('todos')
  const [expandido, setExpandido] = useState(null)
  const [exportando, setExportando] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [montoTxt, setMontoTxt] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadIngresos(); loadPlanCuentas() }, [anioFiltro])

  const loadIngresos = async () => {
    setLoading(true)
    let query = supabase.from('otros_ingresos')
      .select('*, movimientos(fecha, descripcion, rut_detectado, n_documento, cartolas(nombre_archivo, mes, anio))')
      .order('fecha', { ascending: false })
    if (anioFiltro !== 'todos') {
      query = query.gte('fecha', `${anioFiltro}-01-01`).lte('fecha', `${anioFiltro}-12-31`)
    }
    const { data, error } = await query
    if (error) console.error('Error cargando ingresos:', error)
    setIngresos(data || [])
    setLoading(false)
  }

  const loadPlanCuentas = async () => {
    const { data } = await supabase.from('plan_cuentas').select('id,nombre').eq('activo', true).eq('tipo', 'ingreso').order('nombre')
    setPlanCuentas(data || [])
  }

  const openNew = () => {
    setForm({ ...EMPTY, fecha: hoyStr() })
    setMontoTxt('')
    setEditId(null)
    setShowModal(true)
  }

  const openEdit = (ing) => {
    setForm({
      concepto: ing.concepto || '',
      descripcion: ing.descripcion || '',
      monto: ing.monto || 0,
      fecha: ing.fecha || hoyStr(),
      origen: ing.origen || 'manual',
      archivo: null,
    })
    setMontoTxt(formatearMonto(ing.monto || 0))
    setEditId(ing.id)
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.concepto) { showToast('Selecciona un concepto', 'error'); return }
    const monto = parsearMonto(montoTxt)
    if (monto <= 0) { showToast('Ingresa un monto válido', 'error'); return }
    if (!form.fecha) { showToast('Ingresa una fecha', 'error'); return }

    setSaving(true)
    try {
      let storagePath = null, nombreArchivo = null
      if (form.archivo) {
        const path = `otros_ingresos/manual/${Date.now()}_${form.archivo.name}`
        const { error: upErr } = await supabase.storage.from('cartolas').upload(path, form.archivo)
        if (!upErr) { storagePath = path; nombreArchivo = form.archivo.name }
      }
      const payload = {
        concepto: form.concepto,
        descripcion: form.descripcion || null,
        monto,
        fecha: form.fecha,
        origen: form.origen,
      }
      if (storagePath) { payload.storage_path = storagePath; payload.nombre_archivo = nombreArchivo }
      let error
      if (editId) {
        ;({ error } = await supabase.from('otros_ingresos').update(payload).eq('id', editId))
      } else {
        ;({ error } = await supabase.from('otros_ingresos').insert(payload))
      }
      if (error) throw new Error(error.message)
      showToast(editId ? 'Ingreso actualizado' : 'Ingreso registrado')
      setShowModal(false)
      loadIngresos()
    } catch (e) {
      showToast('Error: ' + e.message, 'error')
    }
    setSaving(false)
  }

  const handleEliminar = async (ing) => {
    if (ing.origen === 'cartola' && ing.movimiento_id) {
      showToast('Este ingreso viene de una cartola. Desconcílialo desde la página Cartola.', 'error')
      return
    }
    if (!confirm(`¿Eliminar ingreso "${ing.concepto}" por ${formatearMontoConSimbolo(ing.monto)}?`)) return
    if (ing.storage_path) await supabase.storage.from('cartolas').remove([ing.storage_path])
    const { error } = await supabase.from('otros_ingresos').delete().eq('id', ing.id)
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    showToast('Ingreso eliminado')
    loadIngresos()
  }

  const verArchivo = async (path) => {
    const { data } = await supabase.storage.from('cartolas').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else showToast('Error al obtener el archivo', 'error')
  }

  const handleSubirArchivoExtra = async (ing, file) => {
    if (!file) return
    const path = `otros_ingresos/${ing.id}/${Date.now()}_${file.name}`
    const { error: upErr } = await supabase.storage.from('cartolas').upload(path, file)
    if (upErr) { showToast('Error subiendo archivo: ' + upErr.message, 'error'); return }
    if (ing.storage_path) await supabase.storage.from('cartolas').remove([ing.storage_path])
    await supabase.from('otros_ingresos').update({ storage_path: path, nombre_archivo: file.name }).eq('id', ing.id)
    showToast('Archivo subido')
    loadIngresos()
  }

  const handleExportar = async () => {
    if (ingresos.length === 0) { showToast('No hay datos para exportar', 'error'); return }
    setExportando(true)
    try {
      const XLSX = await import('xlsx')
      const rows = ingresosFiltrados.map(i => ({
        'Fecha': i.fecha ? i.fecha.split('-').reverse().join('/') : '',
        'Concepto': i.concepto,
        'Descripción': i.descripcion || '',
        'Monto': i.monto,
        'Origen': i.origen || 'manual',
        'Archivo': i.nombre_archivo || '',
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 30 }, { wch: 14 }, { wch: 10 }, { wch: 30 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Otros ingresos')
      XLSX.writeFile(wb, `Otros_ingresos_${anioFiltro}.xlsx`)
      showToast('Excel exportado')
    } catch (e) {
      showToast('Error al exportar', 'error')
    }
    setExportando(false)
  }

  const ingresosFiltrados = ingresos.filter(i => origenFiltro === 'todos' || i.origen === origenFiltro)
  const totalIngresos = ingresosFiltrados.length
  const montoTotal = ingresosFiltrados.reduce((t, i) => t + (i.monto || 0), 0)
  const desdeCartola = ingresosFiltrados.filter(i => i.origen === 'cartola').length
  const manuales = ingresosFiltrados.filter(i => i.origen === 'manual').length
  const efectivo = ingresosFiltrados.filter(i => i.origen === 'efectivo').length

  return (
    <div>
      {ToastComponent}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif' }}>Año:</span>
        <select value={anioFiltro} onChange={e => setAnioFiltro(e.target.value)} style={{ fontSize: 13, width: 'auto' }}>
          <option value="todos">Todos</option>
          {[2026, 2025, 2024].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: '1rem' }}>
        <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.85rem 1rem', borderLeft: '3px solid #afa9ec' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Total ingresos</div>
          <div style={{ fontSize: 22, fontWeight: 'bold', color: '#afa9ec' }}>{totalIngresos}</div>
        </div>
        <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.85rem 1rem', borderLeft: '3px solid #5dcaa5' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Monto total</div>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: '#5dcaa5' }}>{formatearMontoConSimbolo(montoTotal)}</div>
        </div>
        <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.85rem 1rem', borderLeft: '3px solid #85b7eb' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Desde cartola</div>
          <div style={{ fontSize: 22, fontWeight: 'bold', color: '#85b7eb' }}>{desdeCartola}</div>
        </div>
        <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.85rem 1rem', borderLeft: '3px solid #fac775' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Manuales + Efectivo</div>
          <div style={{ fontSize: 22, fontWeight: 'bold', color: '#fac775' }}>{manuales + efectivo}</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 2 }}>{manuales} manuales · {efectivo} efectivo</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-coin"></i> Otros ingresos ({ingresosFiltrados.length})</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { id: 'todos', label: 'Todos' },
                { id: 'cartola', label: 'Cartola' },
                { id: 'manual', label: 'Manual' },
                { id: 'efectivo', label: 'Efectivo' },
              ].map(f => (
                <button key={f.id} className={`btn btn-sm${origenFiltro === f.id ? ' btn-primary' : ''}`} onClick={() => setOrigenFiltro(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <button className="btn btn-sm" style={{ color: '#5dcaa5', borderColor: 'rgba(29,158,117,0.4)' }} onClick={handleExportar} disabled={exportando}>
              {exportando ? <><i className="ti ti-loader"></i> Exportando…</> : <><i className="ti ti-file-spreadsheet"></i> Excel</>}
            </button>
            {editable && (
              <button className="btn btn-primary btn-sm" onClick={openNew}>
                <i className="ti ti-plus"></i> Nuevo ingreso
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
        ) : ingresosFiltrados.length === 0 ? (
          <div className="empty-state"><i className="ti ti-coin-off"></i>No hay otros ingresos registrados con este filtro</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Concepto</th><th>Descripción</th><th>Monto</th><th>Origen</th><th>Respaldo</th><th></th>
              </tr>
            </thead>
            <tbody>
              {ingresosFiltrados.map(ing => {
                const open = expandido === ing.id
                return (
                  <React.Fragment key={ing.id}>
                    <tr onClick={() => setExpandido(open ? null : ing.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ color: 'var(--text-muted)' }}>{ing.fecha ? ing.fecha.split('-').reverse().join('/') : '—'}</td>
                      <td>
                        <span className="badge" style={{ background: 'rgba(175,169,236,0.15)', color: '#afa9ec', border: '0.5px solid rgba(175,169,236,0.3)' }}>
                          {ing.concepto}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ing.descripcion || '—'}</td>
                      <td style={{ color: '#5dcaa5', fontWeight: 'bold' }}>{formatearMontoConSimbolo(ing.monto)}</td>
                      <td>{origenBadge(ing.origen)}</td>
                      <td>
                        {ing.nombre_archivo ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#afa9ec', cursor: 'pointer' }}
                            onClick={(e) => { e.stopPropagation(); verArchivo(ing.storage_path) }}>
                            <i className={`ti ${ing.nombre_archivo.toLowerCase().endsWith('.pdf') ? 'ti-file-type-pdf' : 'ti-photo'}`}></i> Ver
                          </span>
                        ) : <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>—</span>}
                      </td>
                      <td><i className={`ti ti-chevron-${open ? 'up' : 'down'}`} style={{ color: 'var(--text-muted)' }}></i></td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} style={{ background: 'rgba(10,22,40,0.4)', padding: '1.25rem 1.5rem' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontFamily: 'sans-serif' }}>Detalle</div>
                              {ing.origen === 'cartola' && ing.movimientos ? (
                                <>
                                  <div style={{ fontSize: 12, color: '#c8d0dc' }}>{ing.movimientos.descripcion}</div>
                                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, fontFamily: 'sans-serif' }}>
                                    RUT: {ing.movimientos.rut_detectado || '—'} · Doc N° {ing.movimientos.n_documento || '—'}
                                  </div>
                                  {ing.movimientos.cartolas && (
                                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, fontFamily: 'sans-serif' }}>
                                      Cartola: {ing.movimientos.cartolas.nombre_archivo}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <>
                                  <div style={{ fontSize: 12, color: '#c8d0dc' }}>{ing.descripcion || '—'}</div>
                                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, fontFamily: 'sans-serif' }}>
                                    Registrado {ing.origen === 'efectivo' ? 'en efectivo' : 'manualmente'} · Sin vinculación a cartola
                                  </div>
                                </>
                              )}
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontFamily: 'sans-serif' }}>Respaldo</div>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                {ing.nombre_archivo ? (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, background: 'var(--navy-card)', border: '0.5px solid var(--border)', fontSize: 11, cursor: 'pointer' }}
                                    onClick={() => verArchivo(ing.storage_path)}>
                                    <i className={`ti ${ing.nombre_archivo.toLowerCase().endsWith('.pdf') ? 'ti-file-type-pdf' : 'ti-photo'}`} style={{ color: ing.nombre_archivo.toLowerCase().endsWith('.pdf') ? '#f09595' : '#85b7eb' }}></i>
                                    {ing.nombre_archivo}
                                    <i className="ti ti-eye" style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 4 }}></i>
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>Sin respaldo adjunto</span>
                                )}
                                {editable && (
                                  <>
                                    <button className="btn btn-sm" onClick={() => document.getElementById(`file-ing-${ing.id}`).click()}>
                                      <i className="ti ti-upload"></i> {ing.nombre_archivo ? 'Reemplazar' : 'Subir'}
                                    </button>
                                    <input type="file" id={`file-ing-${ing.id}`} style={{ display: 'none' }} accept=".pdf,.jpg,.jpeg,.png"
                                      onChange={(e) => { handleSubirArchivoExtra(ing, e.target.files[0]); e.target.value = '' }} />
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          {editable && ing.origen !== 'cartola' && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 12, paddingTop: 10, borderTop: '0.5px solid var(--border)' }}>
                              <button className="btn btn-sm" onClick={() => openEdit(ing)}><i className="ti ti-edit"></i> Editar</button>
                              <button className="btn btn-sm btn-danger" onClick={() => handleEliminar(ing)}>
                                <i className="ti ti-trash"></i> Eliminar
                              </button>
                            </div>
                          )}
                          {ing.origen === 'cartola' && (
                            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '0.5px solid var(--border)', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <i className="ti ti-info-circle"></i>
                              Este ingreso vino de la conciliación de una cartola. Para eliminarlo, desconcilia el movimiento desde la página Cartola.
                            </div>
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

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ width: 540 }}>
            <div className="modal-header">
              <div className="modal-title">{editId ? 'Editar ingreso' : 'Nuevo ingreso'}</div>
              <button className="btn btn-sm" onClick={() => setShowModal(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group full"><label>Concepto *</label>
                <select value={form.concepto} onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))}>
                  <option value="">Seleccionar del plan de cuentas…</option>
                  {planCuentas.map(pc => <option key={pc.id} value={pc.nombre}>{pc.nombre}</option>)}
                </select>
              </div>
              <div className="form-group full"><label>Descripción</label>
                <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Detalle del ingreso…" />
              </div>
              <div className="form-group"><label>Monto ($) *</label>
                <input type="text" inputMode="numeric" value={montoTxt}
                  onChange={e => setMontoTxt(e.target.value)}
                  onBlur={() => { const n = parsearMonto(montoTxt); if (n > 0) setMontoTxt(formatearMonto(n)) }}
                  onFocus={() => { const n = parsearMonto(montoTxt); if (n > 0) setMontoTxt(String(n)) }}
                  placeholder="50.000" />
              </div>
              <div className="form-group"><label>Fecha *</label>
                <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div className="form-group"><label>Origen</label>
                <select value={form.origen} onChange={e => setForm(f => ({ ...f, origen: e.target.value }))}>
                  <option value="manual">Manual</option>
                  <option value="efectivo">Efectivo</option>
                </select>
              </div>
              <div className="form-group"><label>Respaldo (opcional)</label>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" id="file-nuevo-ing" style={{ display: 'none' }}
                  onChange={e => setForm(f => ({ ...f, archivo: e.target.files[0] || null }))} />
                {form.archivo ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(175,169,236,0.1)', borderRadius: 6, padding: '4px 10px', fontSize: 11 }}>
                    <i className={`ti ${form.archivo.name.toLowerCase().endsWith('.pdf') ? 'ti-file-type-pdf' : 'ti-photo'}`} style={{ color: '#afa9ec' }}></i>
                    <span style={{ color: '#c8d0dc' }}>{form.archivo.name}</span>
                    <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
                      onClick={() => setForm(f => ({ ...f, archivo: null }))} title="Quitar">
                      <i className="ti ti-x"></i>
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-sm" style={{ color: '#afa9ec', borderColor: 'rgba(175,169,236,0.4)' }}
                    onClick={() => document.getElementById('file-nuevo-ing').click()}>
                    <i className="ti ti-paperclip"></i> Adjuntar archivo
                  </button>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editId ? 'Guardar cambios' : 'Registrar ingreso'}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
