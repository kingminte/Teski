import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'

const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim())

// Perfil del socio: edita SU email de contacto y SU preferencia de avisos de la
// Escuela. Todo acotado por el socio_id del usuario logueado (no puede tocar
// el perfil de otro socio: la query filtra por su propio id).
export default function MiPerfil() {
  const { user } = useAuth()
  const { showToast, ToastComponent } = useToast()
  const miSocioId = user?.socio_id

  const [socio, setSocio] = useState(null)
  const [emailDraft, setEmailDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingEmail, setSavingEmail] = useState(false)
  const [savingAviso, setSavingAviso] = useState(false)

  useEffect(() => { if (miSocioId) load() }, [miSocioId])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('socios')
      .select('email, recibe_avisos_escuela, nombre, apellido')
      .eq('id', miSocioId).maybeSingle()
    setSocio(data || null)
    setEmailDraft(data?.email || '')
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

  const toggleAviso = async () => {
    const nuevo = !socio.recibe_avisos_escuela
    setSavingAviso(true)
    const { error } = await supabase.from('socios').update({ recibe_avisos_escuela: nuevo }).eq('id', miSocioId)
    setSavingAviso(false)
    if (error) { showToast('Error al guardar la preferencia: ' + error.message, 'error'); return }
    setSocio(s => ({ ...s, recibe_avisos_escuela: nuevo }))
    showToast(nuevo ? 'Recibirás avisos de la Escuela' : 'Ya no recibirás avisos de la Escuela')
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

  const activo = !!socio.recibe_avisos_escuela

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {ToastComponent}

      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, color: 'var(--gold-light)', fontSize: 20 }}>Mi perfil</h2>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          {socio.nombre} {socio.apellido}
        </div>
      </div>

      {/* Correo de contacto */}
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

      {/* Preferencia de avisos de la Escuela */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-ski-jumping"></i> Avisos de la Escuela de esquí</div>
        </div>
        <div style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, color: '#c8d0dc' }}>Recibir avisos por email de la Escuela de esquí</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginTop: 4, lineHeight: 1.5 }}>
              Inscripciones abiertas, horarios de clases y novedades de la Escuela. Si lo desactivas, no recibirás estos correos.
            </div>
          </div>
          <button onClick={toggleAviso} disabled={savingAviso} title={activo ? 'Desactivar' : 'Activar'}
            style={{
              flexShrink: 0, background: 'none', border: 'none', cursor: savingAviso ? 'default' : 'pointer',
              color: activo ? '#5dcaa5' : 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'sans-serif', fontSize: 13,
            }}>
            <i className={`ti ${activo ? 'ti-toggle-right' : 'ti-toggle-left'}`} style={{ fontSize: 28 }}></i>
            {activo ? 'Activado' : 'Desactivado'}
          </button>
        </div>
      </div>
    </div>
  )
}
