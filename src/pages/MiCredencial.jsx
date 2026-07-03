import { useEffect, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/useAuth'
import { useToast } from '../lib/useToast.jsx'
import CredencialCard from '../components/CredencialCard'
import { urlPublica, obtenerTokenEstable } from '../lib/credencial'

export default function MiCredencial() {
  const { user } = useAuth()
  const { showToast, ToastComponent } = useToast()
  // El acceso depende de tener un socio vinculado (socio_id), no del rol.
  const miSocioId = user?.socio_id

  const [socio, setSocio] = useState(null)
  const [beneficiarios, setBeneficiarios] = useState([])
  const [token, setToken] = useState(null)
  const [loading, setLoading] = useState(true)
  const [bajando, setBajando] = useState(false)
  const cardRef = useRef(null)

  useEffect(() => { if (miSocioId) load() }, [miSocioId])

  const load = async () => {
    setLoading(true)
    // Token ESTABLE por socio (get-or-create): el QR es fijo y compartible.
    const [{ data: soc }, { data: benes }, tk] = await Promise.all([
      supabase.from('socios')
        .select('id,numero_socio,nombre,apellido,estado')
        .eq('id', miSocioId).maybeSingle(),
      supabase.from('beneficiarios')
        .select('nombre,apellido,estado').eq('socio_id', miSocioId),
      obtenerTokenEstable(miSocioId),
    ])
    setSocio(soc || null)
    setBeneficiarios(benes || [])
    setToken(tk || null)
    setLoading(false)
  }

  const descargar = async () => {
    if (!cardRef.current) return
    setBajando(true)
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 3, cacheBust: true })
      const a = document.createElement('a')
      a.download = `credencial-${socio.numero_socio}.png`
      a.href = dataUrl
      a.click()
    } catch {
      showToast('No se pudo generar la imagen', 'error')
    } finally {
      setBajando(false)
    }
  }

  const compartir = async () => {
    const url = urlPublica(token)
    if (navigator.share) {
      try { await navigator.share({ title: 'Mi Credencial — Teski Club', url }) } catch { /* cancelado */ }
    } else {
      try { await navigator.clipboard.writeText(url); showToast('Enlace copiado al portapapeles') }
      catch { showToast('No se pudo copiar el enlace', 'error') }
    }
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

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      {ToastComponent}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, color: 'var(--gold-light)', fontSize: 20 }}>Mi Credencial</h2>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          Credencial digital del socio. Validable por QR.
        </div>
      </div>

      <CredencialCard ref={cardRef} socio={socio} beneficiarios={beneficiarios} url={url} />

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={descargar} disabled={bajando}>
          <i className="ti ti-download"></i> {bajando ? 'Generando…' : 'Descargar imagen'}
        </button>
        <button className="btn" onClick={compartir}>
          <i className="ti ti-share"></i> Compartir
        </button>
      </div>

      <div style={{ marginTop: 18, fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        Esta credencial es validable escaneando el código QR o ingresando a{' '}
        <span style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>{url}</span>
      </div>
    </div>
  )
}
