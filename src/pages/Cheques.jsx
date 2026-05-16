import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { formatearMontoConSimbolo, parsearMonto, formatearMonto } from '../lib/montos'
import { useBancos } from '../lib/useBancos'

const CONCEPTOS = [
  { value: 'cuota_social', label: 'Cuota social' },
  { value: 'incorporacion', label: 'Incorporación' },
  { value: 'otro', label: 'Otro' },
]

const EMPTY_FORM = {
  numero: '', socio_id: '', emisor: '', banco_emisor: 'Banco Estado',
  monto: '', concepto: 'cuota_social', concepto_descripcion: '',
  fecha_deposito: '', banco_destino: 'Banco Estado', comentario: '',
}

export default function Cheques() {
  const { showToast, ToastComponent } = useToast()
  const [cheques, setCheques] = useState([])
  const [socios, setSocios] = useState([])
  const [movimientos, setMovimientos] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [montoForm, setMontoForm] = useState('')
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [filtroSocio, setFiltroSocio] = useState('')
  const [filtroConcepto, setFiltroConcepto] = useState('')
  const [duplicadoWarning, setDuplicadoWarning] = useState('')
  const { bancos: BANCOS } = useBancos()
  const [amarrarId, setAmarrarId] = useState(null)
  const [movId, setMovId] = useState('')

  useEffect(() => {
    load()
    supabase.from('socios').select('id,nombre,apellido,numero_socio').order('numero_socio').then(({ data }) => setSocios(data || []))
    supabase.from('movimientos').select('id,fecha,descripcion,monto').eq('tipo','abono').eq('estado','pendiente').order('fecha', { ascending: false }).then(({ data }) => setMovimientos(data || []))
  }, [])

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('cheques')
      .select('*, socios(nombre,apellido,numero_socio)')
      .order('fecha_deposito', { ascending: true, nullsFirst: false })
      .order('numero', { ascending: false })
    if (error) console.error('Error cargando cheques:', error)
    setCheques(data || [])
    setLoading(false)
  }

  // Filtros combinados
  const filtrados = cheques
    .filter(c => filtroEstado === 'todos' || c.estado === filtroEstado)
    .filter(c => filtroSocio === '' || c.socio_id === filtroSocio)
    .filter(c => filtroConcepto === '' || c.concepto === filtroConcepto)

  const openNew = () => {
    setForm(EMPTY_FORM)
    setMontoForm('')
    setDuplicadoWarning('')
    setEditId(null)
    setShowModal(true)
  }

  const openEdit = (c) => {
    setForm({
      numero: c.numero,
      socio_id: c.socio_id || '',
      emisor: c.emisor || '',
      banco_emisor: c.banco_emisor || 'Banco Estado',
      monto: c.monto ? String(c.monto) : '',
      concepto: c.concepto,
      concepto_descripcion: c.concepto_descripcion || '',
      fecha_deposito: c.fecha_deposito || '',
      banco_destino: c.banco_destino || 'Banco Estado',
      comentario: c.comentario || '',
    })
    setMontoForm(c.monto ? formatearMonto(c.monto) : '')
    setDuplicadoWarning('')
    setEditId(c.id)
    setShowModal(true)
  }

  // Verificar duplicado al cambiar número o banco emisor
  const verificarDuplicado = (numero, banco_emisor) => {
    if (!numero || !banco_emisor) { setDuplicadoWarning(''); return }
    const existe = cheques.find(c =>
      c.numero.trim().toLowerCase() === numero.trim().toLowerCase() &&
      c.banco_emisor?.toLowerCase() === banco_emisor.toLowerCase() &&
      c.id !== editId
    )
    if (existe) {
      setDuplicadoWarning(`Ya existe un cheque N°${numero} del ${banco_emisor} (${existe.estado === 'por_depositar' ? 'Por depositar' : existe.estado === 'depositado' ? 'Depositado' : 'Anulado'})`)
    } else {
      setDuplicadoWarning('')
    }
  }

  const handleSave = async () => {
    if (!form.numero || !montoForm) { showToast('Número de cheque y monto son obligatorios', 'error'); return }
    if (duplicadoWarning) { showToast('No se puede guardar: el cheque ya existe', 'error'); return }
    setSaving(true)
    const monto = parsearMonto(montoForm)
    const payload = { ...form, monto, socio_id: form.socio_id || null }
    let error
    if (editId) {
      ;({ error } = await supabase.from('cheques').update(payload).eq('id', editId))
    } else {
      ;({ error } = await supabase.from('cheques').insert(payload))
    }
    setSaving(false)
    if (error) showToast('Error al guardar cheque', 'error')
    else { showToast(editId ? 'Cheque actualizado' : 'Cheque registrado'); setShowModal(false); load() }
  }

  const handleAmarrar = async (chequeId) => {
    if (!movId) { showToast('Selecciona un movimiento', 'error'); return }
    const { error } = await supabase.from('cheques').update({ movimiento_id: movId, estado: 'depositado' }).eq('id', chequeId)
    if (error) showToast('Error al amarrar', 'error')
    else {
      await supabase.from('movimientos').update({ estado: 'conciliado' }).eq('id', movId)
      showToast('Cheque amarrado a cartola correctamente')
      setAmarrarId(null); setMovId(''); load()
    }
  }

  const handleCambiarEstado = async (id, estado) => {
    const { error } = await supabase.from('cheques').update({ estado }).eq('id', id)
    if (error) showToast('Error al actualizar', 'error')
    else { showToast('Estado actualizado'); load() }
  }

  const handleExportar = async () => {
    if (filtrados.length === 0) { showToast('No hay datos para exportar', 'error'); return }
    setExportando(true)
    try {
      const XLSX = await import('xlsx')
      const rows = filtrados.map(c => ({
        'N° Cheque': c.numero,
        'Socio': c.socios ? `${c.socios.nombre} ${c.socios.apellido}` : '',
        'Emisor': c.emisor || '',
        'Banco emisor': c.banco_emisor || '',
        'Monto': c.monto,
        'Concepto': CONCEPTOS.find(x => x.value === c.concepto)?.label || c.concepto,
        'Detalle concepto': c.concepto_descripcion || '',
        'Fecha depósito': c.fecha_deposito ? c.fecha_deposito.split('-').reverse().join('/') : '',
        'Banco destino': c.banco_destino || '',
        'Estado': c.estado === 'por_depositar' ? 'Por depositar' : c.estado === 'depositado' ? 'Depositado' : 'Anulado',
        'Comentario': c.comentario || '',
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [{ wch: 12 },{ wch: 22 },{ wch: 20 },{ wch: 16 },{ wch: 12 },{ wch: 16 },{ wch: 20 },{ wch: 14 },{ wch: 16 },{ wch: 14 },{ wch: 25 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Cheques')
      XLSX.writeFile(wb, `Cheques_${filtroEstado}.xlsx`)
      showToast('Excel exportado correctamente')
    } catch (e) {
      showToast('Error al exportar', 'error')
    }
    setExportando(false)
  }

  const F = (key) => ({ value: form[key] || '', onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) })

  const estadoBadge = (estado) => {
    if (estado === 'por_depositar') return <span className="badge badge-pending">Por depositar</span>
    if (estado === 'depositado') return <span className="badge badge-active">Depositado</span>
    return <span className="badge badge-inactive">Anulado</span>
  }

  const limpiarFiltros = () => { setFiltroEstado('todos'); setFiltroSocio(''); setFiltroConcepto('') }
  const hayFiltros = filtroEstado !== 'todos' || filtroSocio !== '' || filtroConcepto !== ''

  return (
    <div>
      {ToastComponent}

      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-writing"></i> Cheques ({filtrados.length})</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-sm" style={{ color: '#5dcaa5', borderColor: 'rgba(29,158,117,0.4)' }}
              onClick={handleExportar} disabled={exportando}>
              {exportando ? <><i className="ti ti-loader"></i> Exportando…</> : <><i className="ti ti-file-spreadsheet"></i> Excel</>}
            </button>
            <button className="btn btn-primary btn-sm" onClick={openNew}>
              <i className="ti ti-plus"></i> Registrar cheque
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div style={{ padding: '0.75rem 1.25rem', borderBottom: '0.5px solid var(--border)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: 1, textTransform: 'uppercase' }}>Estado</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {['todos','por_depositar','depositado','anulado'].map(f => (
                <button key={f} className={`btn btn-sm${filtroEstado === f ? ' btn-primary' : ''}`} onClick={() => setFiltroEstado(f)}>
                  {f === 'todos' ? 'Todos' : f === 'por_depositar' ? 'Por depositar' : f === 'depositado' ? 'Depositados' : 'Anulados'}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: 1, textTransform: 'uppercase' }}>Socio</label>
            <select value={filtroSocio} onChange={e => setFiltroSocio(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}>
              <option value="">Todos los socios</option>
              {socios.map(s => <option key={s.id} value={s.id}>{s.nombre} {s.apellido}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: 1, textTransform: 'uppercase' }}>Concepto</label>
            <select value={filtroConcepto} onChange={e => setFiltroConcepto(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}>
              <option value="">Todos</option>
              {CONCEPTOS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          {hayFiltros && (
            <button className="btn btn-sm" onClick={limpiarFiltros} style={{ marginTop: 16 }}>
              <i className="ti ti-x"></i> Limpiar filtros
            </button>
          )}
        </div>

        {loading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
        ) : filtrados.length === 0 ? (
          <div className="empty-state"><i className="ti ti-writing"></i>No hay cheques con ese filtro</div>
        ) : (
          <table>
            <thead>
              <tr><th>N° Cheque</th><th>Emisor / Socio</th><th>Banco emisor</th><th>Monto</th><th>Concepto</th><th>F. depósito</th><th>Estado</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {filtrados.map(c => (
                <>
                  <tr key={c.id}>
                    <td><span className="chip">{c.numero}</span></td>
                    <td>
                      <div>{c.socios ? `${c.socios.nombre} ${c.socios.apellido}` : c.emisor || '—'}</div>
                      {c.socios && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{c.socios.numero_socio}</div>}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{c.banco_emisor || '—'}</td>
                    <td style={{ color: '#5dcaa5', fontWeight: 'bold' }}>{formatearMontoConSimbolo(c.monto)}</td>
                    <td>
                      <span className="badge" style={{ background: 'rgba(55,138,221,0.15)', color: '#85b7eb', border: '0.5px solid rgba(55,138,221,0.3)' }}>
                        {CONCEPTOS.find(x => x.value === c.concepto)?.label}
                      </span>
                      {c.concepto_descripcion && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{c.concepto_descripcion}</div>}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {c.fecha_deposito ? c.fecha_deposito.split('-').reverse().join('/') : '—'}
                    </td>
                    <td>{estadoBadge(c.estado)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button className="btn btn-sm" title="Editar" onClick={() => openEdit(c)}>
                          <i className="ti ti-edit"></i>
                        </button>
                        {c.estado === 'por_depositar' && (
                          <>
                            <button className="btn btn-sm" onClick={() => setAmarrarId(amarrarId === c.id ? null : c.id)}>
                              <i className="ti ti-link"></i> Amarrar
                            </button>
                            <button className="btn btn-sm" onClick={() => handleCambiarEstado(c.id, 'depositado')}>
                              <i className="ti ti-check"></i>
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => { if (confirm('¿Anular este cheque?')) handleCambiarEstado(c.id, 'anulado') }}>
                              <i className="ti ti-ban"></i>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {amarrarId === c.id && (
                    <tr key={`amarrar-${c.id}`}>
                      <td colSpan={8} style={{ background: 'rgba(201,168,76,0.05)', padding: '0.75rem 1.5rem' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Amarrar a movimiento:</span>
                          <select value={movId} onChange={e => setMovId(e.target.value)} style={{ flex: 1, fontSize: 12 }}>
                            <option value="">Seleccionar movimiento de cartola…</option>
                            {movimientos.map(m => (
                              <option key={m.id} value={m.id}>
                                {m.fecha.split('-').reverse().join('/')} — {m.descripcion} — {formatearMontoConSimbolo(Math.abs(m.monto))}
                              </option>
                            ))}
                          </select>
                          <button className="btn btn-primary btn-sm" onClick={() => handleAmarrar(c.id)}>Confirmar</button>
                          <button className="btn btn-sm" onClick={() => { setAmarrarId(null); setMovId('') }}>Cancelar</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ width: 580 }}>
            <div className="modal-header">
              <div className="modal-title">{editId ? 'Editar cheque' : 'Registrar cheque'}</div>
              <button className="btn btn-sm" onClick={() => setShowModal(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label>N° Cheque *</label>
                <input placeholder="004521"
                  value={form.numero}
                  onChange={e => {
                    setForm(f => ({ ...f, numero: e.target.value }))
                    verificarDuplicado(e.target.value, form.banco_emisor)
                  }} />
                {duplicadoWarning && (
                  <div style={{ fontSize: 11, color: '#f09595', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <i className="ti ti-alert-circle" style={{ fontSize: 13 }}></i> {duplicadoWarning}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>Monto ($) *</label>
                <input
                  type="text" inputMode="numeric"
                  value={montoForm}
                  onChange={e => setMontoForm(e.target.value)}
                  onBlur={() => { const n = parsearMonto(montoForm); if (n > 0) setMontoForm(formatearMonto(n)) }}
                  onFocus={() => { const n = parsearMonto(montoForm); if (n > 0) setMontoForm(String(n)) }}
                  placeholder="150.000 o 150000"
                />
                {parsearMonto(montoForm) > 0 && (
                  <div style={{ fontSize: 11, color: '#5dcaa5', marginTop: 4 }}>
                    Se guardará como: {formatearMontoConSimbolo(parsearMonto(montoForm))}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>Socio (si aplica)</label>
                <select {...F('socio_id')}>
                  <option value="">Sin socio asociado</option>
                  {socios.map(s => <option key={s.id} value={s.id}>{s.nombre} {s.apellido} ({s.numero_socio})</option>)}
                </select>
              </div>
              <div className="form-group"><label>Emisor (nombre libre)</label><input placeholder="Juan Pérez" {...F('emisor')} /></div>
              <div className="form-group">
                <label>Banco emisor</label>
                <select value={form.banco_emisor} onChange={e => {
                  setForm(f => ({ ...f, banco_emisor: e.target.value }))
                  verificarDuplicado(form.numero, e.target.value)
                }}>
                  {BANCOS.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Concepto *</label>
                <select {...F('concepto')}>
                  {CONCEPTOS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              {form.concepto === 'otro' && (
                <div className="form-group full"><label>Descripción concepto</label><input placeholder="Descripción…" {...F('concepto_descripcion')} /></div>
              )}
              <div className="form-group"><label>Fecha a depositar</label><input type="date" {...F('fecha_deposito')} /></div>
              <div className="form-group">
                <label>Banco destino</label>
                <select {...F('banco_destino')}>
                  {BANCOS.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div className="form-group full"><label>Comentario</label><input placeholder="Notas opcionales" {...F('comentario')} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !!duplicadoWarning}>
                {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editId ? 'Guardar cambios' : 'Registrar cheque'}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
