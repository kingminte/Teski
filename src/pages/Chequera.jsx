import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import { formatearMontoConSimbolo, parsearMonto, formatearMonto } from '../lib/montos'

const EMPTY_CHEQUERA = { nombre: '', banco: 'Banco Estado', folio_inicial: '', folio_final: '' }
const EMPTY_DETALLE = { folio: '', fecha: new Date().toISOString().slice(0,10), beneficiario: '', concepto: '', monto: '', estado: 'emitido', cuenta_id: '' }

export default function Chequera() {
  const { showToast, ToastComponent } = useToast()
  const { puedeEditar } = useAuth()
  const editable = puedeEditar('chequera') || puedeEditar('cheques')
  const fileRef = useRef()
  const [chequeras, setChequeras] = useState([])
  const [cuentasPorPagar, setCuentasPorPagar] = useState([])
  const [selected, setSelected] = useState(null)
  const [detalles, setDetalles] = useState([])
  const [movimientosVinculados, setMovimientosVinculados] = useState({})
  const [loadingDet, setLoadingDet] = useState(false)
  const [showModalChequera, setShowModalChequera] = useState(false)
  const [showModalDetalle, setShowModalDetalle] = useState(false)
  const [formChequera, setFormChequera] = useState(EMPTY_CHEQUERA)
  const [formDetalle, setFormDetalle] = useState(EMPTY_DETALLE)
  const [montoDetalle, setMontoDetalle] = useState('')
  const [editDetalleId, setEditDetalleId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploadingFor, setUploadingFor] = useState(null)
  const [exportando, setExportando] = useState(false)

  useEffect(() => { loadChequeras(); loadCuentasPorPagar() }, [])

  const loadCuentasPorPagar = async () => {
    const { data } = await supabase
      .from('cuentas_por_pagar')
      .select('id,numero,monto_total,monto_pagado,proveedores(nombre)')
      .in('estado', ['pendiente', 'parcial'])
      .order('fecha_vencimiento', { ascending: true })
    setCuentasPorPagar(data || [])
  }
  useEffect(() => { if (selected) loadDetalles(selected.id) }, [selected])

  const loadChequeras = async () => {
    const { data } = await supabase.from('chequeras').select('*').order('created_at', { ascending: false })
    setChequeras(data || [])
    if (data?.length > 0 && !selected) setSelected(data[0])
  }

  const loadDetalles = async (id) => {
    setLoadingDet(true)
    const { data } = await supabase.from('chequera_detalle').select('*').eq('chequera_id', id).order('folio', { ascending: false })
    const detallesData = data || []
    setDetalles(detallesData)

    const detalleIds = detallesData.map(d => d.id)
    if (detalleIds.length > 0) {
      const { data: movs } = await supabase
        .from('movimientos')
        .select('chequera_detalle_id, fecha, cartolas(nombre_archivo)')
        .in('chequera_detalle_id', detalleIds)
      const map = {}
      for (const m of movs || []) {
        if (m.chequera_detalle_id) map[m.chequera_detalle_id] = m
      }
      setMovimientosVinculados(map)
    } else {
      setMovimientosVinculados({})
    }
    setLoadingDet(false)
  }

  // Calcula el siguiente folio correlativo
  const siguienteFolio = () => {
    if (!selected) return ''
    if (detalles.length === 0) return selected.folio_inicial
    const maxFolio = Math.max(...detalles.map(d => d.folio))
    const siguiente = maxFolio + 1
    return siguiente <= selected.folio_final ? siguiente : ''
  }

  const abrirModalDetalle = () => {
    const folio = siguienteFolio()
    setFormDetalle({ ...EMPTY_DETALLE, folio: folio ? String(folio) : '' })
    setMontoDetalle('')
    setEditDetalleId(null)
    setShowModalDetalle(true)
  }

  const handleCrearChequera = async () => {
    if (!formChequera.nombre || !formChequera.folio_inicial || !formChequera.folio_final) {
      showToast('Nombre y folios son obligatorios', 'error'); return
    }
    setSaving(true)
    const { error } = await supabase.from('chequeras').insert({
      ...formChequera,
      folio_inicial: parseInt(formChequera.folio_inicial),
      folio_final: parseInt(formChequera.folio_final),
    })
    setSaving(false)
    if (error) showToast('Error al crear chequera', 'error')
    else { showToast('Chequera creada'); setShowModalChequera(false); setFormChequera(EMPTY_CHEQUERA); loadChequeras() }
  }

  const handleGuardarDetalle = async () => {
    if (!formDetalle.folio) { showToast('El folio es obligatorio', 'error'); return }
    setSaving(true)
    const montoNum = parsearMonto(montoDetalle)
    const { cuenta_id, ...detalleForm } = formDetalle
    const payload = {
      ...detalleForm,
      folio: parseInt(detalleForm.folio),
      monto: montoNum > 0 ? montoNum : null,
      chequera_id: selected.id,
    }
    let error, detalleId
    if (editDetalleId) {
      ;({ error } = await supabase.from('chequera_detalle').update({ ...detalleForm, monto: montoNum > 0 ? montoNum : null }).eq('id', editDetalleId))
      detalleId = editDetalleId
    } else {
      const { data, error: e } = await supabase.from('chequera_detalle').insert(payload).select('id').single()
      error = e
      detalleId = data?.id
    }
    if (error) { setSaving(false); showToast('Error al guardar', 'error'); return }

    if (!editDetalleId && cuenta_id && detalleId && montoNum > 0) {
      const cuenta = cuentasPorPagar.find(c => c.id === cuenta_id)
      if (cuenta) {
        const { error: ePago } = await supabase.from('pagos_cuenta').insert({
          cuenta_id,
          monto: montoNum,
          fecha_pago: detalleForm.fecha,
          medio_pago: 'cheque',
          chequera_detalle_id: detalleId,
          comentario: `Cheque N°${payload.folio}`,
          estado: 'pagado',
        })
        if (ePago) {
          setSaving(false)
          showToast('Cheque registrado pero error vinculando con la cuenta: ' + ePago.message, 'error')
          setShowModalDetalle(false)
          loadDetalles(selected.id)
          return
        }
        const nuevoPagado = (cuenta.monto_pagado || 0) + montoNum
        const nuevoEstado = nuevoPagado >= cuenta.monto_total ? 'pagada' : 'parcial'
        await supabase.from('cuentas_por_pagar').update({ monto_pagado: nuevoPagado, estado: nuevoEstado }).eq('id', cuenta_id)
        loadCuentasPorPagar()
      }
    }

    setSaving(false)
    showToast(editDetalleId ? 'Actualizado' : (cuenta_id ? 'Cheque registrado y vinculado a la cuenta' : 'Uso registrado'))
    setShowModalDetalle(false)
    loadDetalles(selected.id)
  }

  const handleCambiarEstado = async (id, estado) => {
    await supabase.from('chequera_detalle').update({ estado }).eq('id', id)
    loadDetalles(selected.id)
  }

  const handleSubirRespaldo = async (file, detalleId) => {
    const ext = file.name.split('.').pop().toLowerCase()
    const permitidos = ['pdf','jpg','jpeg','png','gif','webp','heic']
    if (!permitidos.includes(ext)) {
      showToast('Formato no permitido. Usa PDF, JPG o PNG', 'error')
      setUploadingFor(null)
      return
    }
    setUploadingFor(detalleId)
    const path = `chequeras/${selected.id}/${detalleId}_${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('cartolas').upload(path, file, { upsert: true })
    if (error) showToast('Error al subir respaldo', 'error')
    else {
      await supabase.from('chequera_detalle').update({ storage_path: path }).eq('id', detalleId)
      showToast('Respaldo subido correctamente')
      loadDetalles(selected.id)
    }
    setUploadingFor(null)
  }

  const handleVerRespaldo = async (storagePath) => {
    const { data } = await supabase.storage.from('cartolas').createSignedUrl(storagePath, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else showToast('Error al obtener el archivo', 'error')
  }

  const handleDescargarRespaldo = async (storagePath, detalleId) => {
    const { data } = await supabase.storage.from('cartolas').createSignedUrl(storagePath, 60)
    if (data?.signedUrl) {
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = storagePath.split('/').pop()
      a.click()
    } else showToast('Error al descargar', 'error')
  }

  const handleBorrarRespaldo = async (detalleId, storagePath) => {
    if (!confirm('¿Eliminar el respaldo adjunto?')) return
    const { error } = await supabase.storage.from('cartolas').remove([storagePath])
    if (error) { showToast('Error al eliminar respaldo', 'error'); return }
    await supabase.from('chequera_detalle').update({ storage_path: null }).eq('id', detalleId)
    showToast('Respaldo eliminado')
    loadDetalles(selected.id)
  }

  const handleExportarExcel = async () => {
    if (!selected || detalles.length === 0) { showToast('No hay datos para exportar', 'error'); return }
    setExportando(true)
    try {
      const XLSX = await import('xlsx')
      const rows = detalles.map(d => {
        const mov = movimientosVinculados[d.id]
        return {
          'Folio': d.folio,
          'Fecha': d.fecha ? d.fecha.split('-').reverse().join('/') : '',
          'Beneficiario': d.beneficiario || '',
          'Concepto': d.concepto || '',
          'Monto': d.monto || 0,
          'Estado': d.estado,
          'Cobrado en cartola': mov
            ? `${mov.fecha ? mov.fecha.split('-').reverse().join('/') : ''}${mov.cartolas?.nombre_archivo ? ' — ' + formatearNombreCartola(mov.cartolas.nombre_archivo) : ''}`
            : (d.estado === 'anulado' ? '' : d.estado === 'cobrado' ? 'Cobrado (sin cartola)' : 'Pendiente'),
          'Respaldo': d.storage_path ? 'Sí' : 'No',
        }
      })
      const ws = XLSX.utils.json_to_sheet(rows)
      // Ancho de columnas
      ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 25 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 28 }, { wch: 10 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, selected.nombre)
      XLSX.writeFile(wb, `${selected.nombre.replace(/\s/g,'_')}.xlsx`)
      showToast('Excel exportado correctamente')
    } catch (e) {
      showToast('Error al exportar', 'error')
    }
    setExportando(false)
  }

  const handleCambiarEstadoChequera = async (id, estado) => {
    await supabase.from('chequeras').update({ estado }).eq('id', id)
    loadChequeras()
  }

  const usados = detalles.length
  const foliosTotal = selected ? (selected.folio_final - selected.folio_inicial + 1) : 0
  const disponibles = foliosTotal - usados
  const sigFolio = siguienteFolio()

  const FC = (key) => ({ value: formChequera[key] || '', onChange: e => setFormChequera(f => ({ ...f, [key]: e.target.value })) })
  const FD = (key) => ({ value: formDetalle[key] || '', onChange: e => setFormDetalle(f => ({ ...f, [key]: e.target.value })) })

  const estadoBadge = (estado) => {
    if (estado === 'activa') return <span className="badge badge-active">Activa</span>
    if (estado === 'agotada') return <span className="badge badge-pending">Agotada</span>
    return <span className="badge badge-inactive">Anulada</span>
  }

  const formatearNombreCartola = (nombre) => {
    if (!nombre) return 'Cartola'
    return nombre
      .replace(/\.(xlsx|xls|csv)$/i, '')
      .replace(/_/g, ' ')
      .replace(/Cartola de cuenta Corriente\s*-?\s*/i, 'Cartola ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const detEstadoBadge = (estado) => {
    if (estado === 'cobrado') return <span className="badge badge-active">Cobrado</span>
    if (estado === 'emitido') return <span className="badge badge-pending">Emitido</span>
    return <span className="badge badge-inactive">Anulado</span>
  }

  return (
    <div>
      {ToastComponent}
      <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.heic" style={{ display: 'none' }}
        onChange={e => { if (uploadingFor) handleSubirRespaldo(e.target.files[0], uploadingFor) }} />

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
        {/* Lista chequeras */}
        <div>
          <div className="card">
            <div className="card-header">
              <div className="card-title"><i className="ti ti-book"></i> Chequeras</div>
              {editable && <button className="btn btn-primary btn-sm" onClick={() => setShowModalChequera(true)}><i className="ti ti-plus"></i></button>}
            </div>
            {chequeras.length === 0 ? (
              <div className="empty-state" style={{ padding: '1.5rem' }}><i className="ti ti-book-off"></i>Sin chequeras</div>
            ) : (
              chequeras.map(c => (
                <div key={c.id} onClick={() => setSelected(c)} style={{
                  padding: '0.75rem 1.25rem', cursor: 'pointer',
                  background: selected?.id === c.id ? 'rgba(201,168,76,0.08)' : 'transparent',
                  borderLeft: `2px solid ${selected?.id === c.id ? 'var(--gold)' : 'transparent'}`,
                  borderBottom: '0.5px solid rgba(201,168,76,0.08)',
                }}>
                  <div style={{ fontSize: 13, color: selected?.id === c.id ? 'var(--gold-light)' : '#c8d0dc', fontWeight: 'bold' }}>{c.nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{c.banco} · Folios {c.folio_inicial}–{c.folio_final}</div>
                  <div style={{ marginTop: 4 }}>{estadoBadge(c.estado)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Detalle */}
        <div>
          {selected ? (
            <div className="card">
              <div className="card-header">
                <div className="card-title"><i className="ti ti-list"></i> {selected.nombre}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                    {usados} usados · {disponibles} disponibles
                    {sigFolio ? ` · Próximo: ${sigFolio}` : ''}
                  </span>
                  <button className="btn btn-sm" style={{ color: '#5dcaa5', borderColor: 'rgba(29,158,117,0.4)' }}
                    onClick={handleExportarExcel} disabled={exportando}>
                    {exportando ? <><i className="ti ti-loader"></i> Exportando…</> : <><i className="ti ti-file-spreadsheet"></i> Excel</>}
                  </button>
                  {selected.estado === 'activa' && (
                    <button className="btn btn-sm" onClick={() => handleCambiarEstadoChequera(selected.id, 'agotada')}>Marcar agotada</button>
                  )}
                  {editable && (
                    <button className="btn btn-primary btn-sm" onClick={abrirModalDetalle}>
                      <i className="ti ti-plus"></i> Registrar uso
                    </button>
                  )}
                </div>
              </div>

              {loadingDet ? (
                <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
              ) : detalles.length === 0 ? (
                <div className="empty-state"><i className="ti ti-list-off"></i>Sin usos registrados aún</div>
              ) : (
                <table>
                  <thead>
                    <tr><th>Folio</th><th>Fecha</th><th>Beneficiario</th><th>Concepto</th><th>Monto</th><th>Estado</th><th>Cobrado en cartola</th><th>Respaldo</th><th></th></tr>
                  </thead>
                  <tbody>
                    {detalles.map(d => (
                      <tr key={d.id}>
                        <td><span className="chip">{String(d.folio).padStart(3,'0')}</span></td>
                        <td style={{ color: 'var(--text-muted)' }}>{d.fecha ? d.fecha.split('-').reverse().join('/') : '—'}</td>
                        <td>{d.beneficiario || '—'}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.concepto || '—'}</td>
                        <td style={{ color: '#f09595', fontWeight: 'bold' }}>
                          {d.monto ? formatearMontoConSimbolo(d.monto) : '—'}
                        </td>
                        <td>
                          {detEstadoBadge(d.estado)}
                          {d.estado === 'emitido' && (
                            <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => handleCambiarEstado(d.id, 'cobrado')}>Cobrado</button>
                          )}
                        </td>
                        <td>
                          {(() => {
                            const mov = movimientosVinculados[d.id]
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
                            if (d.estado === 'anulado') {
                              return <span style={{ color: 'var(--text-dim)' }}>—</span>
                            }
                            if (d.estado === 'cobrado') {
                              return <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'sans-serif' }}>Cobrado (sin cartola)</span>
                            }
                            return <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'sans-serif' }}>Pendiente</span>
                          })()}
                        </td>
                        <td>
                          {d.storage_path ? (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-sm" style={{ color: '#5dcaa5', borderColor: 'rgba(29,158,117,0.4)' }}
                                onClick={() => handleVerRespaldo(d.storage_path)}>
                                <i className="ti ti-eye"></i> Ver
                              </button>
                              <button className="btn btn-sm" onClick={() => handleDescargarRespaldo(d.storage_path, d.id)}>
                                <i className="ti ti-download"></i>
                              </button>
                              <button className="btn btn-sm btn-danger" title="Eliminar respaldo"
                                onClick={() => handleBorrarRespaldo(d.id, d.storage_path)}>
                                <i className="ti ti-trash"></i>
                              </button>
                            </div>
                          ) : (
                            <button className="btn btn-sm" onClick={() => { setUploadingFor(d.id); fileRef.current?.click() }}>
                              {uploadingFor === d.id
                                ? <><i className="ti ti-loader"></i> Subiendo…</>
                                : <><i className="ti ti-upload"></i> Subir</>}
                            </button>
                          )}
                        </td>
                        <td>
                          <button className="btn btn-sm" title="Editar" onClick={() => {
                            setFormDetalle({
                              folio: String(d.folio),
                              fecha: d.fecha || new Date().toISOString().slice(0,10),
                              beneficiario: d.beneficiario || '',
                              concepto: d.concepto || '',
                              monto: d.monto ? String(d.monto) : '',
                              estado: d.estado,
                            })
                            setMontoDetalle(d.monto ? formatearMonto(d.monto) : '')
                            setEditDetalleId(d.id)
                            setShowModalDetalle(true)
                          }}>
                            <i className="ti ti-edit"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div className="empty-state" style={{ marginTop: '2rem' }}><i className="ti ti-book"></i>Selecciona una chequera</div>
          )}
        </div>
      </div>

      {/* Modal nueva chequera */}
      {showModalChequera && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModalChequera(false)}>
          <div className="modal" style={{ width: 440 }}>
            <div className="modal-header">
              <div className="modal-title">Nueva chequera</div>
              <button className="btn btn-sm" onClick={() => setShowModalChequera(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group full"><label>Nombre / Identificador *</label><input placeholder="Chequera 2026-A" {...FC('nombre')} /></div>
              <div className="form-group full">
                <label>Banco</label>
                <select {...FC('banco')}>
                  {['Banco Estado','BCI','Santander','Scotiabank','Falabella','Itaú','Security'].map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div className="form-group"><label>Folio inicial *</label><input type="number" placeholder="001" {...FC('folio_inicial')} /></div>
              <div className="form-group"><label>Folio final *</label><input type="number" placeholder="100" {...FC('folio_final')} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModalChequera(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCrearChequera} disabled={saving}>
                {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Crear chequera</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal registrar uso */}
      {showModalDetalle && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModalDetalle(false)}>
          <div className="modal" style={{ width: 500 }}>
            <div className="modal-header">
              <div className="modal-title">Registrar uso de cheque</div>
              <button className="btn btn-sm" onClick={() => setShowModalDetalle(false)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label>Folio *</label>
                <input type="number" {...FD('folio')} />
                {sigFolio && (
                  <div style={{ fontSize: 11, color: '#5dcaa5', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <i className="ti ti-arrow-right" style={{ fontSize: 12 }}></i>
                    Folio sugerido: {sigFolio} (último usado: {detalles.length > 0 ? Math.max(...detalles.map(d => d.folio)) : selected.folio_inicial - 1})
                  </div>
                )}
              </div>
              <div className="form-group"><label>Fecha</label><input type="date" {...FD('fecha')} /></div>
              <div className="form-group full"><label>Beneficiario</label><input placeholder="A quién se emitió" {...FD('beneficiario')} /></div>
              <div className="form-group full"><label>Concepto / Descripción</label><input placeholder="Para qué se usó" {...FD('concepto')} /></div>
              <div className="form-group">
                <label>Monto ($)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={montoDetalle}
                  onChange={e => setMontoDetalle(e.target.value)}
                  onBlur={() => {
                    const n = parsearMonto(montoDetalle)
                    if (n > 0) setMontoDetalle(formatearMonto(n))
                  }}
                  onFocus={() => {
                    const n = parsearMonto(montoDetalle)
                    if (n > 0) setMontoDetalle(String(n))
                  }}
                  placeholder="45.000 o 45000"
                />
                {parsearMonto(montoDetalle) > 0 && (
                  <div style={{ fontSize: 11, color: '#5dcaa5', marginTop: 4 }}>
                    Se guardará como: {formatearMontoConSimbolo(parsearMonto(montoDetalle))}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>Estado</label>
                <select {...FD('estado')}>
                  <option value="emitido">Emitido</option>
                  <option value="cobrado">Cobrado</option>
                  <option value="anulado">Anulado</option>
                </select>
              </div>
              {!editDetalleId && (
                <div className="form-group full">
                  <label>Vincular a cuenta por pagar (opcional)</label>
                  <select {...FD('cuenta_id')}>
                    <option value="">Sin vincular</option>
                    {cuentasPorPagar.map(c => {
                      const pendiente = c.monto_total - (c.monto_pagado || 0)
                      return (
                        <option key={c.id} value={c.id}>
                          N°{String(c.numero || '').padStart(3, '0')} — {c.proveedores?.nombre || 'Sin proveedor'} — ${pendiente.toLocaleString('es-CL')} pendiente
                        </option>
                      )
                    })}
                  </select>
                  {formDetalle.cuenta_id && (
                    <div style={{ fontSize: 11, color: '#5dcaa5', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <i className="ti ti-link" style={{ fontSize: 12 }}></i>
                      Se registrará un pago por el monto del cheque y se actualizará la cuenta.
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModalDetalle(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleGuardarDetalle} disabled={saving}>
                {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Guardar</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
