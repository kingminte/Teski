import { useState } from 'react'
import { useAuth } from '../lib/useAuth'
import logo from '../assets/logo.png'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sesionExpirada = new URLSearchParams(window.location.search).get('expired') === 'true'

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await login(username, password)
      window.location.href = result.debe_cambiar_clave ? '/cambiar-clave' : (result.rutaInicial || '/dashboard')
    } catch (err) {
      setError(err.message || 'Error al iniciar sesión')
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--navy)' }}>
      <div style={{
        background: 'var(--navy-card)', border: '0.5px solid var(--border-strong)',
        borderRadius: 16, padding: '2.5rem', width: 360,
      }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img src={logo} alt="Teski Club" style={{ width: 180, display: 'block', margin: '0 auto 1rem', filter: 'brightness(1.1)' }} />
          <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 4, letterSpacing: 1 }}>SISTEMA DE SOCIOS</div>
        </div>

        {sesionExpirada && (
          <div style={{ background: 'rgba(239,159,39,0.1)', border: '0.5px solid rgba(239,159,39,0.3)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: 12, color: '#fac775', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'sans-serif' }}>
            <i className="ti ti-clock" style={{ fontSize: 16 }}></i>
            Tu sesión expiró. Por favor inicia sesión nuevamente.
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-group">
            <label>Usuario</label>
            <input
              type="text" required autoFocus
              value={username} onChange={e => setUsername(e.target.value)}
              placeholder="Usuario"
            />
          </div>
          <div className="form-group">
            <label>Contraseña</label>
            <input
              type="password" required
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {error && (
            <div style={{ fontSize: 12, color: '#f09595', fontFamily: 'sans-serif', background: 'rgba(226,75,74,0.1)', padding: '8px 12px', borderRadius: 6 }}>
              {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary" style={{ justifyContent: 'center', marginTop: 8 }} disabled={loading}>
            {loading ? <><i className="ti ti-loader"></i> Ingresando...</> : <><i className="ti ti-login"></i> Iniciar sesión</>}
          </button>
        </form>
      </div>
    </div>
  )
}
