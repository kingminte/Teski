import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/useAuth'
import { useToast } from '../lib/useToast.jsx'
import CredencialCard from '../components/CredencialCard'
import { urlPublica } from '../lib/credencial'
import { useCredencialToken } from '../lib/useCredencialToken'

export default function MiCredencial() {
  const { user } = useAuth()
  const { ToastComponent } = useToast()
  // El acceso depende de tener un socio vinculado (socio_id), no del rol.
  const miSocioId = user?.socio_id

  const [socio, setSocio] = useState(null)
  const [beneficiarios, setBeneficiarios] = useState([])
  const [loading, setLoading] = useState(true)

  // Token efímero rotativo (60s). Se llama siempre (regla de hooks).
  const { token, segundos, total, sinConexion } = useCredencialToken(miSocioId)

  useEffect(() => { if (miSocioId) load() }, [miSocioId])

  const load = async () => {
    setLoading(true)
    const [{ data: soc }, { data: benes }] = await Promise.all([
      supabase.from('socios')
        .select('id,numero_socio,nombre,apellido,estado')
        .eq('id', miSocioId).maybeSingle(),
      supabase.from('beneficiarios')
        .select('nombre,apellido,estado').eq('socio_id', miSocioId),
    ])
    setSocio(soc || null)
    setBeneficiarios(benes || [])
    setLoading(false)
  }

  if (!miSocioId) {
    return (
      <div className="card">
        <div className="empty-state">
          <i className="ti ti-id" style={{ color: 'var(--gold-dim)' }}></i>
          Tu usuario no está vinculado a un socio del club, por lo que no tiene credencial.
        </div>
      </div>
    )
  }
  if (loading) {
    return <div className="card"><div className="empty-state"><i className="ti ti-loader"></i>Cargando credencial…</div></div>
  }
  if (!socio) {
    return <div className="card"><div className="empty-state"><i className="ti ti-alert-triangle"></i>No se encontró el socio asociado a tu usuario.</div></div>
  }

  const url = urlPublica(token)
  const pct = Math.round((segundos / total) * 100)

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      {ToastComponent}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, color: 'var(--gold-light)', fontSize: 20 }}>Mi Credencial</h2>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          Credencial digital del socio. El QR se renueva cada 60 segundos por seguridad.
        </div>
      </div>

      <CredencialCard socio={socio} beneficiarios={beneficiarios} url={url} />

      {/* Countdown + barra de progreso */}
      <div style={{ marginTop: 14 }}>
        {sinConexion ? (
          <div style={{ fontSize: 12, color: '#fac775', fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="ti ti-wifi-off"></i> Sin conexión — no se pudo emitir el QR. Reintentando al recargar.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginBottom: 5 }}>
              <span>Código de verificación</span>
              <span>Se renueva en {segundos}s</span>
            </div>
            <div style={{ height: 6, background: 'rgba(201,168,76,0.15)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--gold)', borderRadius: 3, transition: 'width 1s linear' }}></div>
            </div>
          </>
        )}
      </div>

      <div style={{ marginTop: 18, fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        Muestra este código al validador. Se renueva automáticamente cada 60 segundos: no sirve compartirlo ni
        sacarle captura, porque vence enseguida.
      </div>
    </div>
  )
}
