import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import logo from '../assets/logo.png'
import { anioVigente, beneficiariosActivos, nombreCompleto, fechaHoraConsulta } from '../lib/credencial'

const FONDO = { minHeight: '100vh', background: '#f3f5f8', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box' }

// Verificación pública del QR. El token es estable (socios.credencial_token):
// lo que se valida EN VIVO al escanear es el estado ACTUAL del socio, no la
// frescura del código. Nunca expone RUT ni datos de contacto.
export default function CredencialPublica() {
  const [params] = useSearchParams()
  const { token: tokenLegacy } = useParams()   // ruta antigua /credencial/:token
  const token = params.get('t') || tokenLegacy || ''

  const [socio, setSocio] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancel = false
    ;(async () => {
      setLoading(true)
      if (!token) { setSocio(null); setLoading(false); return }
      // Solo columnas NO sensibles: sin RUT, sin email, sin teléfono.
      const { data } = await supabase.from('socios')
        .select('numero_socio,nombre,apellido,estado,beneficiarios(nombre,apellido,estado)')
        .eq('credencial_token', token)
        .maybeSingle()
      if (!cancel) { setSocio(data || null); setLoading(false) }
    })()
    return () => { cancel = true }
  }, [token])

  if (loading) {
    return <div style={FONDO}><div style={{ color: '#64748b', marginTop: 80 }}>Verificando credencial…</div></div>
  }

  // Token inexistente o regenerado → aviso neutro, sin datos del socio.
  if (!socio) {
    return (
      <div style={FONDO}>
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 6px 24px rgba(0,0,0,0.08)', padding: '40px 28px', maxWidth: 380, width: '100%', textAlign: 'center', marginTop: 40 }}>
          <i className="ti ti-help-circle" style={{ fontSize: 48, color: '#94a3b8' }}></i>
          <h1 style={{ fontSize: 20, color: '#1e293b', margin: '16px 0 8px' }}>Credencial no válida</h1>
          <p style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.5, margin: 0 }}>
            Este código no corresponde a ninguna credencial vigente del club.
            Pídale al socio que muestre su credencial actual.
          </p>
        </div>
      </div>
    )
  }

  const vigente = socio.estado === 'activo'
  const meta = vigente
    ? { label: 'CREDENCIAL VIGENTE', icon: 'ti-circle-check', color: '#1D9E75', bg: '#e7f6ef', border: '#bfe6d5' }
    : { label: 'CREDENCIAL NO VIGENTE', icon: 'ti-ban', color: '#C62F2F', bg: '#fbe8e8', border: '#eec2c2' }
  const benes = vigente ? beneficiariosActivos(socio.beneficiarios) : []

  return (
    <div style={FONDO}>
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 6px 24px rgba(0,0,0,0.10)', maxWidth: 400, width: '100%', overflow: 'hidden' }}>
        {/* Cabecera con logo */}
        <div style={{ background: '#0d1e38', padding: '20px 24px 16px', textAlign: 'center' }}>
          <img src={logo} alt="Teski Club" style={{ width: 150, maxWidth: '70%', display: 'block', margin: '0 auto' }} />
          <div style={{ fontSize: 10, color: '#9fb3cc', letterSpacing: 2, marginTop: 6 }}>FUNDADO 1 DIC 1940 🇨🇱</div>
        </div>

        <div style={{ padding: '22px 24px 26px' }}>
          {/* Badge grande de estado */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: meta.bg, border: `1px solid ${meta.border}`, color: meta.color,
            borderRadius: 12, padding: '12px', fontWeight: 800, fontSize: 16, letterSpacing: 0.5,
          }}>
            <i className={`ti ${meta.icon}`} style={{ fontSize: 22 }}></i>
            {meta.label}
          </div>

          {/* Año vigente — solo tiene sentido si la credencial vale */}
          {vigente && (
            <div style={{ textAlign: 'center', margin: '14px 0 18px' }}>
              <span style={{ fontSize: 11, color: '#94a3b8', letterSpacing: 2 }}>VIGENCIA</span>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#1e293b', lineHeight: 1 }}>{anioVigente()}</div>
            </div>
          )}

          {/* Datos mínimos: nombre y N° de socio. Nunca RUT ni contacto. */}
          <Campo label="Titular" valor={nombreCompleto(socio)} />
          <Campo label="N° de socio" valor={socio.numero_socio} />

          {benes.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10.5, color: '#94a3b8', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Beneficiarios</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {benes.map((b, i) => (
                  <div key={i} style={{ fontSize: 14, color: '#334155', display: 'flex', gap: 7, alignItems: 'center' }}>
                    <i className="ti ti-point-filled" style={{ fontSize: 10, color: '#cbd5e1' }}></i>{nombreCompleto(b)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!vigente && (
            <div style={{ marginTop: 16, background: '#fbe8e8', border: '1px solid #eec2c2', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: '#8f2626', lineHeight: 1.5 }}>
              Este socio no se encuentra activo. La credencial no habilita el acceso.
            </div>
          )}

          {/* Pie de verificación */}
          <div style={{ marginTop: 22, paddingTop: 14, borderTop: '1px solid #eef1f5', fontSize: 11, color: '#94a3b8', textAlign: 'center', lineHeight: 1.5 }}>
            Verificado por el sistema Teski Club<br />consultado el {fechaHoraConsulta()}
          </div>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, valor }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10.5, color: '#94a3b8', letterSpacing: 1.5, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, color: '#1e293b', fontWeight: 600, marginTop: 1 }}>{valor}</div>
    </div>
  )
}
