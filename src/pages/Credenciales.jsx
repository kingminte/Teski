import { useEffect, useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/useAuth'
import { useToast } from '../lib/useToast.jsx'
import CredencialCard from '../components/CredencialCard'
import { urlPublica, generarToken } from '../lib/credencial'

export default function Credenciales() {
  const { puedeEditar } = useAuth()
  const { showToast, ToastComponent } = useToast()
  const puedeRotar = puedeEditar('credencial')   // admin/gestor

  const [socios, setSocios] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [sel, setSel] = useState(null)            // socio seleccionado
  const [beneficiarios, setBeneficiarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [bajando, setBajando] = useState(false)
  const [rotando, setRotando] = useState(false)
  const cardRef = useRef(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('socios')
      .select('id,numero_socio,nombre,apellido,rut,estado,credencial_token')
      .order('apellido')
    setSocios(data || [])
    setLoading(false)
  }

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return socios
    return socios.filter(s =>
      `${s.nombre} ${s.apellido}`.toLowerCase().includes(q) ||
      (s.rut || '').toLowerCase().includes(q) ||
      (s.numero_socio || '').toLowerCase().includes(q)
    )
  }, [socios, busqueda])

  const seleccionar = async (socio) => {
    setSel(socio)
    setBeneficiarios([])
    const { data } = await supabase.from('beneficiarios')
      .select('nombre,apellido,estado').eq('socio_id', socio.id)
    setBeneficiarios(data || [])
  }

  const descargar = async () => {
    if (!cardRef.current) return
    setBajando(true)
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 3, cacheBust: true })
      const a = document.createElement('a')
      a.download = `credencial-${sel.numero_socio}.png`
      a.href = dataUrl
      a.click()
    } catch {
      showToast('No se pudo generar la imagen', 'error')
    } finally {
      setBajando(false)
    }
  }

  const rotarToken = async () => {
    if (!sel) return
    if (!window.confirm(`¿Generar un nuevo token para ${sel.nombre} ${sel.apellido}? El QR anterior dejará de funcionar.`)) return
    setRotando(true)
    let nuevo, error, intentos = 0
    do {
      nuevo = generarToken()
      const res = await supabase.from('socios').update({ credencial_token: nuevo }).eq('id', sel.id)
      error = res.error
      intentos++
    } while (error && intentos < 5)
    setRotando(false)
    if (error) { showToast('No se pudo generar el token', 'error'); return }
    const actualizado = { ...sel, credencial_token: nuevo }
    setSel(actualizado)
    setSocios(prev => prev.map(s => s.id === sel.id ? actualizado : s))
    showToast('Nuevo token generado — el QR cambió')
  }

  const url = sel ? urlPublica(sel.credencial_token) : ''

  return (
    <div>
      {ToastComponent}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, color: 'var(--gold-light)', fontSize: 20 }}>Credenciales de socios</h2>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          Busca un socio para ver y descargar su credencial.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Buscador + lista */}
        <div className="card" style={{ flex: '1 1 320px', minWidth: 280, maxWidth: 420, padding: 14 }}>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <i className="ti ti-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', fontSize: 15 }}></i>
            <input
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre, RUT o N° socio…"
              style={{ width: '100%', padding: '8px 10px 8px 32px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {loading && <div className="empty-state" style={{ padding: '1.5rem' }}>Cargando…</div>}
            {!loading && filtrados.length === 0 && <div className="empty-state" style={{ padding: '1.5rem' }}>Sin resultados</div>}
            {filtrados.map(s => (
              <div key={s.id} onClick={() => seleccionar(s)} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                background: sel?.id === s.id ? 'rgba(201,168,76,0.10)' : 'transparent',
                borderLeft: `2px solid ${sel?.id === s.id ? 'var(--gold)' : 'transparent'}`,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.nombre} {s.apellido}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>N° {s.numero_socio} · {s.rut}</div>
                </div>
                <span className={`badge ${s.estado === 'activo' ? 'badge-active' : s.estado === 'inactivo' ? 'badge-inactive' : 'badge-pending'}`} style={{ flexShrink: 0 }}>
                  {s.estado}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Credencial seleccionada */}
        <div style={{ flex: '1 1 360px', minWidth: 300, maxWidth: 520 }}>
          {!sel ? (
            <div className="card"><div className="empty-state"><i className="ti ti-id-badge"></i>Selecciona un socio para ver su credencial.</div></div>
          ) : (
            <>
              <CredencialCard ref={cardRef} socio={sel} beneficiarios={beneficiarios} url={url} />
              <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={descargar} disabled={bajando}>
                  <i className="ti ti-download"></i> {bajando ? 'Generando…' : 'Descargar imagen'}
                </button>
                {puedeRotar && (
                  <button className="btn" onClick={rotarToken} disabled={rotando}>
                    <i className="ti ti-refresh"></i> {rotando ? 'Generando…' : 'Generar nuevo token'}
                  </button>
                )}
              </div>
              <div style={{ marginTop: 16, fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                URL pública: <span style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>{url}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
