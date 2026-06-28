import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
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
  fecha_recepcion: '', fecha_documento: '', banco_destino: 'Banco Estado', comentario: '',
}

export default function Cheques() {
  const { showToast, ToastComponent } = useToast()
  const { puedeEditar } = useAuth()
  const editable = puedeEditar('cheques')
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
  // Mapa { movimiento_id: { fecha, cartolas } } para la columna "En cartola".
  // Se carga en una query separada (igual que Control Chequera) para NO tocar
  // el .select() de cheques: si este join fallara, la lista de cheques no se rompe.
  const [movimientosCartola, setMovimientosCartola] = useState({})

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
      .order('numero', { ascending: false })
    if (error) console.error('Error cargando cheques:', error)
    const chequesData = data || []
    setCheques(chequesData)
    setLoading(false)

    // Join "En cartola" en query separada (espejo de Control Chequera). Aislado:
    // un error aquí no afecta la lista de cheques ya seteada arriba.
    const movIds = chequesData.map(c => c.movimiento_id).filter(Boolean)
    if (movIds.length > 0) {
      const { data: movs } = await supabase
        .from('movimientos')
        .select('id, fecha, cartolas(nombre_archivo)')
        .in('id', movIds)
      const map = {}
      for (const m of movs || []) map[m.id] = m
      setMovimientosCartola(map)
    } else {
      setMovimientosCartola({})
    }
  }

  // Mismo tratamiento que Control Chequera: deriva el nombre visible de la
  // cartola desde nombre_archivo (no hay un campo de nombre por separado).
  const formatearNombreCartola = (nombre) => {
    if (!nombre) return 'Cartola'
    return nombre
      .replace(/\.(xlsx|xls|csv)$/i, '')
      .replace(/_/g, ' ')
      .replace(/Cartola de cuenta Corriente\s*-?\s*/i, 'Cartola ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Fecha efectiva del cheque: la real del banco si ya cayó (fecha_deposito),
  // si no la "a fecha" planificada (fecha_documento).
  const fechaEfectiva = (c) => c.fecha_deposito || c.fecha_documento || ''

  // Filtros combinados + orden por fecha efectiva (planificación), nulls al final
  const filtrados = cheques
    .filter(c => filtroEstado === 'todos' || c.estado === filtroEstado)
    .filter(c => filtroSocio === '' || c.socio_id === filtroSocio)
    .filter(c => filtroConcepto === '' || c.concepto === filtroConcepto)
    .slice()
    .sort((a, b) => {
      const fa = fechaEfectiva(a), fb = fechaEfectiva(b)
      if (fa && fb) { if (fa !== fb) return fa < fb ? -1 : 1 }
      else if (fa) return -1
      else if (fb) return 1
      return (b.numero || '').localeCompare(a.numero || '')
    })

  const openNew = () => {
    setForm({ ...EMPTY_FORM, fecha_recepcion: new Date().toISOString().slice(0, 10) })
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
      fecha_recepcion: c.fecha_recepcion || '',
      fecha_documento: c.fecha_documento || '',
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
    // La fecha del banco manda: el cheque cayó en cartola en la fecha del movimiento.
    const movFecha = movimientos.find(m => m.id === movId)?.fecha || null
    const { error } = await supabase.from('cheques').update({ movimiento_id: movId, estado: 'depositado', fecha_deposito: movFecha }).eq('id', chequeId)
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

  // Revierte un cheque 'depositado' → 'por_depositar'. Solo si NO tiene
  // vinculaciones (movimiento bancario o pago de cuota); si las tiene, bloquea.
  const handleRevertirADepositar = async () => {
    const cheque = cheques.find(c => c.id === editId)
    if (!cheque) return

    // Paso 1 — verificación de vinculaciones (antes de confirmar)
    if (cheque.movimiento_id) {
      showToast('No se puede revertir: este cheque está conciliado con un movimiento bancario. Para revertir, primero hay que descalzar el movimiento desde la pantalla de Cartola Bancaria.', 'error')
      return
    }
    const { data: pagos, error: ePagos } = await supabase
      .from('pagos_cuota').select('id, socios(nombre,apellido)').eq('cheque_id', editId)
    if (ePagos) { showToast('Error al verificar vinculaciones: ' + ePagos.message, 'error'); return }
    if (pagos && pagos.length > 0) {
      const s = pagos[0].socios
      const nombre = s ? `${s.nombre} ${s.apellido}` : 'un socio'
      showToast(`No se puede revertir: este cheque está asociado al pago de cuota de ${nombre}. Para revertir, primero hay que eliminar ese pago de cuota desde la pantalla de Cuotas.`, 'error')
      return
    }

    // Paso 2 — confirmación
    const quien = cheque.emisor || (cheque.socios ? `${cheque.socios.nombre} ${cheque.socios.apellido}` : '—')
    if (!confirm(`El cheque N°${cheque.numero} de ${quien} pasará de 'Depositado' a 'Por depositar'. Su fecha de depósito se limpiará. ¿Continuar?`)) return

    // Paso 3 — ejecución (solo cheques; movimiento_id ya verificado null)
    const { error } = await supabase.from('cheques').update({
      estado: 'por_depositar',
      fecha_deposito: null,
      conciliado_en: null,
      conciliado_por: null,
    }).eq('id', editId)
    if (error) { showToast('Error al revertir: ' + error.message, 'error'); return }
    showToast("Cheque revertido a 'Por depositar'")
    setShowModal(false)
    load()
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
        'Fecha recepción': c.fecha_recepcion ? c.fecha_recepcion.split('-').reverse().join('/') : '',
        'Fecha documento (a fecha)': c.fecha_documento ? c.fecha_documento.split('-').reverse().join('/') : '',
        'Fecha depósito (banco)': c.fecha_deposito ? c.fecha_deposito.split('-').reverse().join('/') : '',
        'Banco destino': c.banco_destino || '',
        'Estado': c.estado === 'por_depositar' ? 'Por depositar' : c.estado === 'depositado' ? 'Depositado' : 'Anulado',
        'Comentario': c.comentario || '',
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [{ wch: 12 },{ wch: 22 },{ wch: 20 },{ wch: 16 },{ wch: 12 },{ wch: 16 },{ wch: 20 },{ wch: 16 },{ wch: 20 },{ wch: 18 },{ wch: 16 },{ wch: 14 },{ wch: 25 }]
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
            {editable && (
              <button className="btn btn-primary btn-sm" onClick={openNew}>
                <i className="ti ti-plus"></i> Registrar cheque
              </button>
            )}
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
              <tr><th>N° Cheque</th><th>Emisor / Socio</th><th>Banco emisor</th><th>Monto</th><th>Concepto</th><th>F. depósito</th><th>Estado</th><th>En cartola</th><th>Acciones</th></tr>
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
                      {(() => {
                        const f = fechaEfectiva(c)
                        if (!f) return '—'
                        const txt = f.split('-').reverse().join('/')
                        // Si aún no cayó en cartola, lo mostrado es la fecha planificada (a fecha)
                        return c.fecha_deposito ? txt : <span title="Fecha planificada (a fecha) — aún no cae en cartola">{txt} *</span>
                      })()}
                    </td>
                    <td>{estadoBadge(c.estado)}</td>
                    <td>
                      {(() => {
                        const mov = c.movimiento_id ? movimientosCartola[c.movimiento_id] : null
                        if (mov) {
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ color: '#5dcaa5', fontWeight: 500, fontSize: 12 }}>
                                {mov.fecha ? mov.fecha.split('-').reverse().join('/') : '—'}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
                                {formatearNombreCartola(mov.cartolas?.nombre_archivo)}
                              </span>
                            </div>
                          )
                        }
                        return <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'sans-serif' }}>Pendiente</span>
                      })()}
                    </td>
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
                      <td colSpan={9} style={{ background: 'rgba(201,168,76,0.05)', padding: '0.75rem 1.5rem' }}>
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
              <div className="form-group"><label>Fecha de recepción</label><input type="date" {...F('fecha_recepcion')} /></div>
              <div className="form-group"><label>Fecha del cheque (a fecha)</label><input type="date" {...F('fecha_documento')} /></div>
              <div className="form-group">
                <label>Banco destino</label>
                <select {...F('banco_destino')}>
                  {BANCOS.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div className="form-group full"><label>Comentario</label><input placeholder="Notas opcionales" {...F('comentario')} /></div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div>
                {editId && cheques.find(c => c.id === editId)?.estado === 'depositado' && (
                  <button className="btn" style={{ color: '#fac775', borderColor: 'rgba(239,159,39,0.4)' }}
                    onClick={handleRevertirADepositar}>
                    <i className="ti ti-arrow-back-up"></i> Volver a 'Por depositar'
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setShowModal(false)}>Cancelar</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving || !!duplicadoWarning}>
                  {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editId ? 'Guardar cambios' : 'Registrar cheque'}</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
