import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { formatearMontoConSimbolo, parsearMonto, formatearMonto } from '../lib/montos'

const FORMAS_PAGO = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'canje', label: 'Canje' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'otro', label: 'Otro' },
]

const EMPTY_FORM = {
  socio_id: '', fecha: new Date().toISOString().slice(0,10),
  monto: '', forma_pago: 'transferencia',
  detalle_pago: '', cheque_id: '', comentario: '',
}

export default function Incorporaciones() {
  const { showToast, ToastComponent } = useToast()
  const fileRef = useRef()
  const [incorporaciones, setIncorporaciones] = useState([])
  const [socios, setSocios] = useState([])
  const [cheques, setCheques] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [uploadingFor, setUploadingFor] = useState(null)

  useEffect(() => {
    load()
    supabase.from('socios').select('id,nombre,apellido,numero_socio').order('numero_socio').then(({ data }) => setSocios(data || []))
    supabase.from('cheques').select('id,numero,monto,estado').eq('estado','por_depositar').then(({ data }) => setCheques(data || []))
  }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('incorporaciones')
      .select('*, socios(nombre,apellido,numero_socio), cheques(numero)')
      .order('fecha', { ascending: false })
    setIncorporaciones(data || [])
    setLoading(false)
  }

  const handleSave = async () => {
    if (!form.socio_id || !form.monto) { showToast('Socio y monto son obligatorios', 'error'); return }
    setSaving(true)
    const payload = {
      ...form,
      monto: parseInt(form.monto),
      cheque_id: form.cheque_id || null,
    }
    const { error, data } = await supabase.from('incorporaciones').insert(payload).select().single()
    setSaving(false)
    if (error) showToast('Error al registrar incorporación', 'error')
    else { showToast('Incorporación registrada'); setShowModal(false); setForm(EMPTY_FORM); load() }
  }

  const handleCambiarEstado = async (id, estado) => {
    const { error } = await supabase.from('incorporaciones').update({ estado }).eq('id', id)
    if (error) showToast('Error al actualizar', 'error')
    else { showToast('Estado actualizado'); load() }
  }

  const handleSubirRespaldo = async (file, incId) => {
    setUploadingFor(incId)
    const path = `incorporaciones/${incId}_${file.name}`
    const { error } = await supabase.storage.from('cartolas').upload(path, file, { upsert: true })
    if (error) showToast('Error al subir archivo', 'error')
    else {
      await supabase.from('incorporaciones').update({ storage_path: path }).eq('id', incId)
      showToast('Respaldo subido'); load()
    }
    setUploadingFor(null)
  }

  const F = (key) => ({ value: form[key] || '', onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) })

  const estadoBadge = (estado) => {
    if (estado === 'pagado') return <span className="badge badge-active">Pagado</span>
    if (estado === 'pendiente') return <span className="badge badge-pending">Pendiente</span>
    return <span className="badge badge-inactive">Anulado</span>
  }

  const totalRecaudado = incorporaciones.filter(i => i.estado === 'pagado').reduce((t, i) => t + i.monto, 0)
  const totalPendiente = incorporaciones.filter(i => i.estado === 'pendiente').reduce((t, i) => t + i.monto, 0)

  return (
    <div>
      {ToastComponent}
      <input ref={fileRef} type="file" style={{ display: 'none' }}
        onChange={e => { if (uploadingFor) handleSubirRespaldo(e.target.files[0], uploadingFor) }} />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: '1.5rem' }}>
        {[
          { label: 'Total incorporaciones', value: incorporaciones.length, color: 'var(--gold-light)' },
          { label: 'Recaudado', value: `$${totalRecaudado.toLocaleString('es-CL')}`, color: '#5dcaa5' },
          { label: 'Pendiente de cobro', value: `$${totalPendiente.toLocaleString('es-CL')}`, color: '#fac775' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-user-plus"></i> Incorporaciones</div>
          <button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY_FORM); setShowModal(true) }}>
            <i className="ti ti-plus"></i> Registrar incorporación
          </button>
        </div>

        {loading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
        ) : incorporaciones.length === 0 ? (
          <div className="empty-state"><i className="ti ti-user-off"></i>No hay incorporaciones registradas</div>
        ) : (
          <table>
            <thead>
              <tr><th>Socio</th><th>Fecha</th><th>Monto</th><th>Forma pago</th><th>Estado</th><th>Respaldo</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {incorporaciones.map(i => (
                <tr key={i.id}>
                  <td>
                    <div className="name-cell">
                      <div className="avatar" style={{ background: 'rgba(83,74,183,0.3)', color: '#afa9ec' }}>
                        {i.socios?.nombre[0]}{i.socios?.apellido[0]}
                      </div>
                      <div>
                        <div>{i.socios?.nombre} {i.socios?.apellido}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{i.socios?.numero_socio}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{i.fecha.split('-').reverse().join('/')}</td>
                  <td style={{ color: '#5dcaa5', fontWeight: 'bold' }}>${i.monto.toLocaleString('es-CL')}</td>
                  <td>
                    <span className="chip">{FORMAS_PAGO.find(f => f.value === i.forma_pago)?.label}</span>
                    {i.cheques && <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 6 }}>N°{i.cheques.numero}</span>}
                    {i.detalle_pago && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{i.detalle_pago}</div>}
                  </td>
                  <td>{estadoBadge(i.estado)}</td>
                  <td>
                    {i.storage_path
                      ? <span style={{ fontSize: 11, color: '#5dcaa5' }}><i className="ti ti-check"></i> Subido</span>
                      : <button className="btn btn-sm" onClick={() => { setUploadingFor(i.id); fileRef.current?.click() }}>
                          {uploadingFor === i.id ? <i className="ti ti-loader"></i> : <><i className="ti ti-upload"></i> Subir</>}
                        </button>
                    }
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {i.estado === 'pendiente' && (
                        <button className="btn btn-sm btn-primary" onClick={() => handleCambiarEstado(i.id, 'pagado')}>
                          <i className="ti ti-check"></i> Pagado
                        </button>
                      )}
                      {i.estado !== 'anulado' && (
                        <button className="btn btn-sm btn-danger" onClick={() => { if (confirm('¿Anular incorporación?')) handleCambiarEstado(i.id, 'anulado') }}>
                          <i className="ti ti-ban"></i>
                        </button>
                      )}
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
          <div className="modal" style={{ width: 540 }}>
            <div className="modal-header">
              <div className="modal-title">Registrar incorporación</div>
              <button className="btn btn-sm" onClick={() => setShowModal(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group full">
                <label>Socio *</label>
                <select {...F('socio_id')}>
                  <option value="">Seleccionar socio…</option>
                  {socios.map(s => <option key={s.id} value={s.id}>{s.nombre} {s.apellido} ({s.numero_socio})</option>)}
                </select>
              </div>
              <div className="form-group"><label>Fecha *</label><input type="date" {...F('fecha')} /></div>
              <div className="form-group"><label>Monto ($) *</label><input type="number" placeholder="500000" {...F('monto')} /></div>
              <div className="form-group">
                <label>Forma de pago</label>
                <select {...F('forma_pago')}>
                  {FORMAS_PAGO.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              {form.forma_pago === 'cheque' && (
                <div className="form-group">
                  <label>Cheque asociado</label>
                  <select {...F('cheque_id')}>
                    <option value="">Sin asociar</option>
                    {cheques.map(c => <option key={c.id} value={c.id}>N°{c.numero} — ${c.monto.toLocaleString('es-CL')}</option>)}
                  </select>
                </div>
              )}
              {['canje','otro'].includes(form.forma_pago) && (
                <div className="form-group full">
                  <label>Descripción del {form.forma_pago}</label>
                  <input placeholder="Detalla el canje o forma de pago…" {...F('detalle_pago')} />
                </div>
              )}
              <div className="form-group full">
                <label>Comentarios</label>
                <textarea rows={2} placeholder="Observaciones sobre la incorporación…" style={{ resize: 'vertical' }}
                  value={form.comentario} onChange={e => setForm(f => ({ ...f, comentario: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Registrar</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
