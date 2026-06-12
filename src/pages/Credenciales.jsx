import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import CredencialCard from '../components/CredencialCard'
import { urlPublica } from '../lib/credencial'
import { useCredencialToken } from '../lib/useCredencialToken'

export default function Credenciales() {
  const { ToastComponent } = useToast()

  const [socios, setSocios] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [sel, setSel] = useState(null)            // socio seleccionado
  const [beneficiarios, setBeneficiarios] = useState([])
  const [loading, setLoading] = useState(true)

  // Token efímero del socio seleccionado (rota cada 60s mientras esté abierto).
  const { token, segundos, total, sinConexion } = useCredencialToken(sel?.id, !!sel)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('socios')
      .select('id,numero_socio,nombre,apellido,rut,estado')
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

  const url = urlPublica(token)
  const pct = Math.round((segundos / total) * 100)

  return (
    <div>
      {ToastComponent}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, color: 'var(--gold-light)', fontSize: 20 }}>Credenciales de socios</h2>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          Busca un socio para ver su credencial. El QR se renueva cada 60 segundos.
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
              <div style={{ marginTop: 14 }}>
                {sinConexion ? (
                  <div style={{ fontSize: 12, color: '#fac775', fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <i className="ti ti-wifi-off"></i> Sin conexión — no se pudo emitir el QR.
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
