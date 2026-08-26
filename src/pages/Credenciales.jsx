import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/useAuth'
import { useToast } from '../lib/useToast.jsx'
import CredencialCard from '../components/CredencialCard'
import { urlPublica, regenerarCredencialToken } from '../lib/credencial'

export default function Credenciales() {
  const { showToast, ToastComponent } = useToast()
  const { esAdmin } = useAuth()

  const [socios, setSocios] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [sel, setSel] = useState(null)            // socio seleccionado
  const [beneficiarios, setBeneficiarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [regenerando, setRegenerando] = useState(false)

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

  // Regenera el token estable: los pantallazos del QR anterior dejan de validar.
  const regenerar = async () => {
    if (!sel) return
    if (!confirm('¿Regenerar el QR de este socio? El QR anterior y sus pantallazos dejarán de funcionar.')) return
    setRegenerando(true)
    const nuevo = await regenerarCredencialToken(sel.id)
    setRegenerando(false)
    if (!nuevo) { showToast('No se pudo regenerar el QR', 'error'); return }
    setSel(s => ({ ...s, credencial_token: nuevo }))
    setSocios(list => list.map(s => s.id === sel.id ? { ...s, credencial_token: nuevo } : s))
    showToast('QR regenerado — el anterior dejó de ser válido')
  }

  const url = urlPublica(sel?.credencial_token)

  return (
    <div>
      {ToastComponent}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, color: 'var(--gold-light)', fontSize: 20 }}>Credenciales de socios</h2>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          Busca un socio para ver su credencial. Muestra o guarda un pantallazo — el QR es válido por la temporada.
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
              <CredencialCard socio={sel} beneficiarios={beneficiarios} url={url} />
              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 11.5, color: 'var(--text-dim)', fontFamily: 'sans-serif', lineHeight: 1.5 }}>
                  El QR se valida en línea contra el estado actual del socio.
                </div>
                {esAdmin() && (
                  <button className="btn btn-sm" onClick={regenerar} disabled={regenerando} title="Invalida el QR anterior y sus pantallazos">
                    <i className="ti ti-refresh"></i> {regenerando ? 'Regenerando…' : 'Regenerar QR'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
