import { useState } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/logo.png'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Credenciales incorrectas. Verifica tu correo y contraseña.')
    setLoading(false)
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

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-group">
            <label>Usuario</label>
            <input
              type="text" required
              value={email} onChange={e => setEmail(e.target.value)}
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

        <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(201,168,76,0.06)', borderRadius: 8, fontSize: 12, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
          <strong style={{ color: 'var(--gold-dim)' }}>Primera vez:</strong> Crea tu usuario en Supabase → Authentication → Users → Invite User
        </div>
      </div>
    </div>
  )
}
