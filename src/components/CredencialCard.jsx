import { forwardRef, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import logo from '../assets/logo.png'
import { anioVigente, beneficiariosActivos, nombreCompleto } from '../lib/credencial'

// Mapeo de socios.estado → tratamiento visual de la credencial.
// activo → azul/verde · pendiente → gris/ámbar · inactivo → rojo.
const ESTADO_CRED = {
  activo: {
    label: 'SOCIO ACTIVO', icon: 'ti-circle-check',
    gradient: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a8c 45%, #5da9d6 100%)',
    filter: 'none',
    badgeBg: 'rgba(29,158,117,0.95)',
  },
  pendiente: {
    label: 'SOCIO PENDIENTE', icon: 'ti-alert-triangle',
    gradient: 'linear-gradient(135deg, #3a3a3a 0%, #5a5a5a 45%, #8a8a8a 100%)',
    filter: 'saturate(0.5)',
    badgeBg: 'rgba(186,117,23,0.95)',
  },
  inactivo: {
    label: 'SOCIO INACTIVO', icon: 'ti-ban',
    gradient: 'linear-gradient(135deg, #5f1e1e 0%, #8c2d2d 45%, #d65d5d 100%)',
    filter: 'saturate(0.5)',
    badgeBg: 'rgba(217,60,60,0.95)',
  },
}

// Credencial visual reutilizable (estilo tarjeta plástica, aspect-ratio 1.59).
// Usada por "Mi credencial" y "Credenciales de socios". Genera su propio QR
// a partir de `url`. forwardRef expone el nodo para exportarlo a imagen.
const CredencialCard = forwardRef(function CredencialCard({ socio, beneficiarios, url }, ref) {
  const [qr, setQr] = useState('')

  useEffect(() => {
    let cancel = false
    if (!url) { setQr(''); return }
    QRCode.toDataURL(url, { margin: 1, width: 160, errorCorrectionLevel: 'M' })
      .then((d) => { if (!cancel) setQr(d) })
      .catch(() => { if (!cancel) setQr('') })
    return () => { cancel = true }
  }, [url])

  if (!socio) return null

  const meta = ESTADO_CRED[socio.estado] || ESTADO_CRED.pendiente
  const benes = beneficiariosActivos(beneficiarios)

  return (
    <div
      ref={ref}
      style={{
        position: 'relative', width: '100%', maxWidth: 480, aspectRatio: '1.59',
        borderRadius: 16, overflow: 'hidden', color: '#fff',
        fontFamily: 'sans-serif', boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
        background: '#1e3a5f',
      }}
    >
      {/* Capa de fondo (gradient + filtro), separada para no desaturar el contenido */}
      <div style={{ position: 'absolute', inset: 0, background: meta.gradient, filter: meta.filter, zIndex: 0 }} />

      {/* Contenido */}
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', padding: '5%' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: '6px 9px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: '58%' }}>
            <img src={logo} alt="Teski Club" style={{ width: '100%', maxWidth: 110, display: 'block' }} />
            <div style={{ fontSize: 8, color: '#1e3a5f', letterSpacing: 1, marginTop: 2, fontWeight: 600 }}>
              FUNDADO 1 DIC 1940 🇨🇱
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 9, letterSpacing: 2, opacity: 0.85 }}>VIGENCIA</div>
            <div style={{ fontSize: 22, fontWeight: 'bold', lineHeight: 1.1 }}>{anioVigente()}</div>
          </div>
        </div>

        {/* Badge de estado */}
        <div style={{ marginTop: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: meta.badgeBg, color: '#fff', borderRadius: 20,
            padding: '5px 12px', fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
          }}>
            <i className={`ti ${meta.icon}`} style={{ fontSize: 15 }}></i>
            {meta.label}
          </span>
        </div>

        {/* Cuerpo: izquierda (datos) + derecha (QR) */}
        <div style={{ display: 'flex', gap: 12, marginTop: 'auto', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, letterSpacing: 1.5, opacity: 0.75, textTransform: 'uppercase' }}>Titular</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, lineHeight: 1.15 }}>
              {nombreCompleto(socio)}
            </div>
            {benes.length > 0 && (
              <>
                <div style={{ fontSize: 9, letterSpacing: 1.5, opacity: 0.75, textTransform: 'uppercase' }}>Beneficiarios</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 2 }}>
                  {benes.map((b, i) => (
                    <div key={i} style={{ fontSize: 11.5, opacity: 0.95, display: 'flex', gap: 5, alignItems: 'center' }}>
                      <span style={{ opacity: 0.6 }}>·</span>{nombreCompleto(b)}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div style={{ flexShrink: 0, textAlign: 'center', width: 76 }}>
            <div style={{ background: '#fff', borderRadius: 8, padding: 5, width: 70, height: 70, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {qr
                ? <img src={qr} alt="QR credencial" style={{ width: '100%', height: '100%', display: 'block' }} />
                : <i className="ti ti-wifi-off" style={{ fontSize: 30, color: '#94a3b8' }}></i>}
            </div>
            {url
              ? <div style={{ fontSize: 11, fontWeight: 700, marginTop: 5, letterSpacing: 0.5 }}>N° {socio.numero_socio}</div>
              : <div style={{ fontSize: 8, opacity: 0.9, marginTop: 5, lineHeight: 1.2 }}>Sin señal para emitir QR</div>}
          </div>
        </div>
      </div>
    </div>
  )
})

export default CredencialCard
