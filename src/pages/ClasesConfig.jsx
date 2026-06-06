import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import { formatearMonto, parsearMonto, formatearMontoConSimbolo } from '../lib/montos'

export default function ClasesConfig() {
  const { showToast, ToastComponent } = useToast()
  const { puedeEditar, user } = useAuth()
  const editable = puedeEditar('clases_config')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tarifaText, setTarifaText] = useState('')
  const [horas, setHoras] = useState('2')
  const [actualizado, setActualizado] = useState(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('clases_config').select('*').eq('id', 1).maybeSingle()
    if (data) {
      setTarifaText(data.tarifa_hora_profesor ? formatearMonto(data.tarifa_hora_profesor) : '')
      setHoras(String(data.horas_minimas_cancelacion ?? 2))
      setActualizado(data.updated_at)
    }
    setLoading(false)
  }

  const handleSave = async () => {
    const tarifa = parsearMonto(tarifaText)
    const h = parseInt(horas, 10)
    if (isNaN(h) || h < 0) { showToast('Las horas mínimas deben ser un número válido', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('clases_config').update({
      tarifa_hora_profesor: tarifa,
      horas_minimas_cancelacion: h,
      updated_at: new Date().toISOString(),
      updated_by: user?.id || null,
    }).eq('id', 1)
    setSaving(false)
    if (error) showToast('Error al guardar: ' + error.message, 'error')
    else { showToast('Configuración guardada'); load() }
  }

  if (loading) return <div className="empty-state"><i className="ti ti-loader"></i>Cargando configuración…</div>

  return (
    <div>
      {ToastComponent}
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-header">
          <div className="card-title"><i className="ti ti-adjustments"></i> Configuración de clases</div>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <div className="form-grid">
            <div className="form-group full">
              <label>Tarifa por hora-profesor (CLP)</label>
              <input
                inputMode="numeric"
                placeholder="Ej: 25.000"
                value={tarifaText}
                disabled={!editable}
                onChange={e => setTarifaText(e.target.value)}
                onFocus={() => { const n = parsearMonto(tarifaText); if (n > 0) setTarifaText(String(n)) }}
                onBlur={() => { const n = parsearMonto(tarifaText); setTarifaText(n > 0 ? formatearMonto(n) : '') }}
              />
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 4 }}>
                Lo que el club le paga a Andacor por cada hora dictada. Actual: <strong>{formatearMontoConSimbolo(parsearMonto(tarifaText))}</strong>
              </div>
            </div>
            <div className="form-group full">
              <label>Horas mínimas para cancelación</label>
              <input
                type="number" min="0"
                value={horas}
                disabled={!editable}
                onChange={e => setHoras(e.target.value)}
              />
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 4 }}>
                Anticipación mínima (en horas) con que un socio puede cancelar una solicitud sin penalización.
              </div>
            </div>
          </div>
          {actualizado && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 8 }}>
              <i className="ti ti-clock" style={{ fontSize: 12 }}></i> Última actualización: {new Date(actualizado).toLocaleString('es-CL')}
            </div>
          )}
          {editable && (
            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Guardar</>}
              </button>
            </div>
          )}
          {!editable && (
            <div style={{ marginTop: '1rem', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
              <i className="ti ti-eye"></i> Modo solo lectura.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
