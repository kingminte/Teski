import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'

const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim())

// Interruptor reutilizable: SOLO el toggle (el estado lo comunica el propio
// icono; sin texto redundante junto al switch).
function Switch({ on, disabled, onToggle }) {
  return (
    <button onClick={() => !disabled && onToggle()} disabled={disabled}
      title={disabled ? 'Requiere el interruptor general' : (on ? 'Desactivar' : 'Activar')}
      style={{
        flexShrink: 0, background: 'none', border: 'none', padding: 0,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
        color: on ? '#5dcaa5' : 'var(--text-dim)', display: 'inline-flex', alignItems: 'center',
      }}>
      <i className={`ti ${on ? 'ti-toggle-right' : 'ti-toggle-left'}`} style={{ fontSize: 30 }}></i>
    </button>
  )
}

// Perfil del socio: edita SU email de contacto y SUS preferencias granulares de
// avisos de la Escuela (jsonb { general, dia_abierto, horario }). Todo acotado al
// socio_id del usuario logueado (la query filtra por su propio id).
export default function MiPerfil() {
  const { user } = useAuth()
  const { showToast, ToastComponent } = useToast()
  const miSocioId = user?.socio_id

  const [socio, setSocio] = useState(null)
  const [emailDraft, setEmailDraft] = useState('')
  const [prefs, setPrefs] = useState({ general: true, dia_abierto: true, horario: true })
  const [loading, setLoading] = useState(true)
  const [savingEmail, setSavingEmail] = useState(false)
  const [savingPref, setSavingPref] = useState(false)

  useEffect(() => { if (miSocioId) load() }, [miSocioId])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('socios')
      .select('email, preferencias_avisos, nombre, apellido')
      .eq('id', miSocioId).maybeSingle()
    setSocio(data || null)
    setEmailDraft(data?.email || '')
    // Claves ausentes → true por robustez.
    const p = data?.preferencias_avisos || {}
    setPrefs({ general: p.general ?? true, dia_abierto: p.dia_abierto ?? true, horario: p.horario ?? true })
    setLoading(false)
  }

  const saveEmail = async () => {
    const val = emailDraft.trim()
    if (!emailValido(val)) { showToast('Ingresa un email válido', 'error'); return }
    setSavingEmail(true)
    const { error } = await supabase.from('socios').update({ email: val }).eq('id', miSocioId)
    setSavingEmail(false)
    if (error) { showToast('Error al guardar el email: ' + error.message, 'error'); return }
    setSocio(s => ({ ...s, email: val }))
    showToast('Correo actualizado')
  }

  // Persiste el jsonb COMPLETO (nunca pisa los específicos al tocar el general).
  const savePrefs = async (next) => {
    setSavingPref(true)
    const { error } = await supabase.from('socios').update({ preferencias_avisos: next }).eq('id', miSocioId)
    setSavingPref(false)
    if (error) { showToast('Error al guardar la preferencia: ' + error.message, 'error'); return false }
    setPrefs(next)
    return true
  }

  const toggleGeneral = async () => {
    const next = { ...prefs, general: !prefs.general }   // específicos se conservan
    const ok = await savePrefs(next)
    if (ok) showToast(next.general ? 'Recibirás avisos de la Escuela' : 'Avisos de la Escuela desactivados')
  }
  const toggleEspecifico = async (key) => {
    if (!prefs.general) return   // deshabilitados mientras el general esté apagado
    const ok = await savePrefs({ ...prefs, [key]: !prefs[key] })
    if (ok) showToast('Preferencia actualizada')
  }

  if (!miSocioId) {
    return (
      <div className="card"><div className="empty-state">
        <i className="ti ti-user-off" style={{ color: 'var(--gold-dim)' }}></i>
        Tu usuario no está vinculado a un socio del club, por lo que no tiene perfil.
      </div></div>
    )
  }
  if (loading) {
    return <div className="card"><div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div></div>
  }
  if (!socio) {
    return <div className="card"><div className="empty-state"><i className="ti ti-alert-triangle"></i>No se encontró tu socio.</div></div>
  }

  const rowStyle = { padding: '1rem 1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }
  const labelStyle = { fontSize: 14, color: '#c8d0dc' }
  const helpStyle = { fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginTop: 4, lineHeight: 1.5 }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {ToastComponent}

      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, color: 'var(--gold-light)', fontSize: 20 }}>Mi perfil</h2>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          {socio.nombre} {socio.apellido}
        </div>
      </div>

      {/* Correo de contacto (sin cambios) */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-mail"></i> Correo de contacto</div>
        </div>
        <div style={{ padding: '1rem 1.5rem' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginBottom: 8 }}>
            A este correo llegan las notificaciones del club.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="email" value={emailDraft} onChange={e => setEmailDraft(e.target.value)}
              placeholder="tucorreo@ejemplo.cl" style={{ flex: 1, minWidth: 220 }} />
            <button className="btn btn-primary" onClick={saveEmail}
              disabled={savingEmail || emailDraft.trim() === (socio.email || '').trim()}>
              {savingEmail ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Guardar</>}
            </button>
          </div>
        </div>
      </div>

      {/* Preferencias granulares de avisos de la Escuela */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-ski-jumping"></i> Avisos de la Escuela de esquí</div>
        </div>

        {/* Maestro: cabecera destacada */}
        <div style={{ ...rowStyle, background: 'rgba(201,168,76,0.07)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...labelStyle, fontWeight: 600, color: 'var(--gold-light)' }}>Avisos de la Escuela de esquí</div>
            <div style={helpStyle}>Interruptor general — gobierna los de abajo.</div>
          </div>
          <Switch on={prefs.general} disabled={savingPref} onToggle={toggleGeneral} />
        </div>

        {/* Específicos: indentados, colgando del general con una línea vertical */}
        <div style={{ marginLeft: 16, borderLeft: '2px solid rgba(201,168,76,0.25)' }}>
          <div style={{ ...rowStyle, paddingLeft: 40 }}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>Fechas nuevas de clases</div>
              <div style={helpStyle}>Cuando se abre inscripción para una fecha.</div>
            </div>
            <Switch on={prefs.dia_abierto} disabled={savingPref || !prefs.general} onToggle={() => toggleEspecifico('dia_abierto')} />
          </div>

          <div style={{ borderTop: '0.5px solid rgba(201,168,76,0.08)' }} />

          <div style={{ ...rowStyle, paddingLeft: 40 }}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>Horario de mis clases</div>
              <div style={helpStyle}>Confirmación de hora de las clases que pedí.</div>
            </div>
            <Switch on={prefs.horario} disabled={savingPref || !prefs.general} onToggle={() => toggleEspecifico('horario')} />
          </div>
        </div>
      </div>
    </div>
  )
}
