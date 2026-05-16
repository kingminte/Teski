import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, hashPassword } from '../lib/useAuth'
import logo from '../assets/logo.png'

export default function CambiarClave() {
  const { user, logout } = useAuth()
  const [nueva, setNueva] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (nueva.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return }
    if (nueva !== confirmar) { setError('Las contraseñas no coinciden'); return }

    setLoading(true)
    try {
      const nuevoHash = await hashPassword(nueva)
      if (nuevoHash === user.password_hash) {
        setError('La nueva contraseña no puede ser igual a la anterior')
        setLoading(false)
        return
      }

      const { error: e1 } = await supabase
        .from('usuarios')
        .update({ password_hash: nuevoHash, debe_cambiar_clave: false })
        .eq('id', user.id)
      if (e1) throw new Error(e1.message)

      const updated = { ...user, password_hash: nuevoHash, debe_cambiar_clave: false }
      localStorage.setItem('teski_user', JSON.stringify(updated))
      window.location.href = '/dashboard'
    } catch (err) {
      setError('Error al cambiar contraseña: ' + err.message)
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--navy)' }}>
      <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border-strong)', borderRadius: 16, padding: '2.5rem', width: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <img src={logo} alt="Teski Club" style={{ width: 140, display: 'block', margin: '0 auto 1rem', filter: 'brightness(1.1)' }} />
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(201,168,76,0.12)', border: '0.5px solid var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <i className="ti ti-lock" style={{ fontSize: 28, color: 'var(--gold-light)' }}></i>
          </div>
          <div style={{ fontSize: 17, color: 'var(--gold-light)', fontWeight: 'bold', marginBottom: 4 }}>Cambio de contraseña obligatorio</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', lineHeight: 1.5 }}>
            Por seguridad, debes cambiar tu contraseña antes de continuar
          </div>
          {user && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 10 }}>
              {user.nombre} · @{user.username}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group">
            <label>Nueva contraseña</label>
            <input type="password" required minLength={6} value={nueva} onChange={e => setNueva(e.target.value)} placeholder="Mínimo 6 caracteres" autoFocus />
          </div>
          <div className="form-group">
            <label>Confirmar contraseña</label>
            <input type="password" required minLength={6} value={confirmar} onChange={e => setConfirmar(e.target.value)} placeholder="Repetir contraseña" />
          </div>
          {error && (
            <div style={{ fontSize: 12, color: '#f09595', fontFamily: 'sans-serif', background: 'rgba(226,75,74,0.1)', padding: '8px 12px', borderRadius: 6 }}>
              {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary" style={{ justifyContent: 'center', marginTop: 4 }} disabled={loading}>
            {loading ? <><i className="ti ti-loader"></i> Cambiando...</> : <><i className="ti ti-key"></i> Cambiar contraseña</>}
          </button>
          <button type="button" className="btn btn-sm" style={{ justifyContent: 'center', marginTop: 2, color: 'var(--text-dim)' }}
            onClick={() => { logout(); window.location.href = '/' }}>
            <i className="ti ti-logout"></i> Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  )
}
