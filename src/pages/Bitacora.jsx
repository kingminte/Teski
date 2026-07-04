import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import BitacoraFormModal from '../components/BitacoraFormModal'

const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
// Fecha ISO → dd/mm/yyyy (regla del proyecto: nunca new Date() para formatear).
const fmtFecha = (iso) => (iso ? iso.split('-').reverse().join('/') : '')
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export default function Bitacora() {
  const { showToast, ToastComponent } = useToast()
  const { user, puedeEditar } = useAuth()
  const editable = puedeEditar('clases_bitacora')   // admin/andacor

  const [socios, setSocios] = useState([])
  const [beneficiarios, setBeneficiarios] = useState([])
  const [loadingBase, setLoadingBase] = useState(true)

  const [search, setSearch] = useState('')
  const [alumnoSel, setAlumnoSel] = useState(null)   // { participante_tipo, participante_id, socio_id, nombre, sub }

  const [historial, setHistorial] = useState([])
  const [usuariosMap, setUsuariosMap] = useState({})
  const [loadingHist, setLoadingHist] = useState(false)

  const [creando, setCreando] = useState(false)      // modal nuevo feedback
  const [editEntrada, setEditEntrada] = useState(null)

  useEffect(() => { if (editable) loadBase() }, [editable])

  const loadBase = async () => {
    setLoadingBase(true)
    const [{ data: socs }, { data: benes }] = await Promise.all([
      supabase.from('socios').select('id,nombre,apellido,numero_socio').order('apellido'),
      supabase.from('beneficiarios').select('id,nombre,apellido,socio_id').order('apellido'),
    ])
    setSocios(socs || [])
    setBeneficiarios(benes || [])
    setLoadingBase(false)
  }

  // Lista unificada de participantes. socio_id se resuelve AQUÍ, en el origen:
  // socio adulto → su propio id; beneficiario → su socio_id (el padre).
  const participantes = useMemo(() => [
    ...socios.map(s => ({
      participante_tipo: 'socio', participante_id: s.id, socio_id: s.id,
      nombre: `${s.nombre} ${s.apellido}`, sub: `Socio${s.numero_socio ? ' N°' + s.numero_socio : ''}`,
    })),
    ...beneficiarios.map(b => ({
      participante_tipo: 'beneficiario', participante_id: b.id, socio_id: b.socio_id,
      nombre: `${b.nombre} ${b.apellido}`, sub: 'Beneficiario',
    })),
  ], [socios, beneficiarios])

  const resultados = useMemo(() => {
    const q = norm(search).trim()
    if (q.length < 2) return []
    return participantes.filter(p => norm(p.nombre).includes(q)).slice(0, 30)
  }, [search, participantes])

  const seleccionar = (p) => { setAlumnoSel(p); setSearch('') }

  useEffect(() => {
    if (!alumnoSel) { setHistorial([]); return }
    loadHistorial(alumnoSel)
  }, [alumnoSel])

  const loadHistorial = async (al) => {
    setLoadingHist(true)
    const { data } = await supabase.from('clases_bitacora')
      .select('*')
      .eq('participante_tipo', al.participante_tipo)
      .eq('participante_id', al.participante_id)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
    const lista = data || []
    // Nombres de autores (created_by → usuarios.nombre)
    const autorIds = [...new Set(lista.map(e => e.created_by).filter(Boolean))]
    const map = {}
    if (autorIds.length) {
      const { data: us } = await supabase.from('usuarios').select('id,nombre').in('id', autorIds)
      ;(us || []).forEach(u => { map[u.id] = u.nombre })
    }
    setUsuariosMap(map)
    setHistorial(lista)
    setLoadingHist(false)
  }

  // Editar/borrar por autoría: solo lo propio; admin todo.
  const puedeGestionar = (e) => user?.rol === 'admin' || e.created_by === user?.id

  const handleBorrar = async (e) => {
    if (!confirm('¿Borrar esta entrada de feedback? No se puede deshacer.')) return
    const { error } = await supabase.from('clases_bitacora').delete().eq('id', e.id)
    if (error) { showToast('Error al borrar: ' + error.message, 'error'); return }
    showToast('Entrada borrada')
    loadHistorial(alumnoSel)
  }

  if (!editable) {
    return (
      <div className="card">
        <div className="empty-state">
          <i className="ti ti-lock" style={{ color: 'var(--gold-dim)' }}></i>
          No tienes acceso a la bitácora de feedback.
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      {ToastComponent}

      {/* Buscador de alumno */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-notebook"></i> Bitácora de feedback</div>
        </div>
        <div style={{ padding: '0.75rem 1.5rem 1.25rem' }}>
          <div className="search-box">
            <i className="ti ti-search"></i>
            <input placeholder="Buscar alumno por nombre (socio o beneficiario)…"
              value={search} onChange={e => setSearch(e.target.value)} disabled={loadingBase} />
          </div>
          {search.trim().length >= 2 && (
            <div style={{ marginTop: 8, border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {resultados.length === 0 ? (
                <div style={{ padding: '12px', fontSize: 13, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Sin resultados</div>
              ) : resultados.map(p => (
                <div key={`${p.participante_tipo}:${p.participante_id}`} onClick={() => seleccionar(p)}
                  style={{ padding: '10px 12px', borderBottom: '0.5px solid rgba(201,168,76,0.08)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, color: '#c8d0dc' }}>{p.nombre}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{p.sub}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Alumno seleccionado + historial */}
      {alumnoSel && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <i className={`ti ${alumnoSel.participante_tipo === 'beneficiario' ? 'ti-baby-carriage' : 'ti-user'}`}></i>
              {alumnoSel.nombre}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginLeft: 8 }}>{alumnoSel.sub}</span>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setCreando(true)}>
              <i className="ti ti-plus"></i> Nuevo feedback
            </button>
          </div>

          {loadingHist ? (
            <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
          ) : historial.length === 0 ? (
            <div className="empty-state"><i className="ti ti-notebook-off"></i>Sin feedback registrado para este alumno.</div>
          ) : (
            <div style={{ padding: '0.5rem 0' }}>
              {historial.map(e => {
                const editado = !!e.updated_by
                const autor = usuariosMap[e.created_by] || '—'
                const gestionable = puedeGestionar(e)
                return (
                  <div key={e.id} style={{ borderBottom: '0.5px solid rgba(201,168,76,0.08)', padding: '0.9rem 1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: 'var(--gold-light)', fontFamily: 'sans-serif', fontWeight: 600 }}>{fmtFecha(e.fecha)}</span>
                          {e.grupo_id && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}><i className="ti ti-clipboard-list" style={{ fontSize: 11 }}></i> desde una clase</span>}
                          {editado && <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'sans-serif', fontStyle: 'italic' }}>· editado</span>}
                        </div>
                        <div style={{ fontSize: 13.5, color: '#c8d0dc', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{e.comentario}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginTop: 5 }}>
                          <i className="ti ti-pencil" style={{ fontSize: 11 }}></i> {autor}
                        </div>
                      </div>
                      {gestionable && (
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          <button className="btn btn-sm" onClick={() => setEditEntrada(e)} title="Editar"><i className="ti ti-edit"></i></button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleBorrar(e)} title="Borrar"><i className="ti ti-trash"></i></button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal crear */}
      {creando && (
        <BitacoraFormModal
          alumno={alumnoSel} fecha={hoyISO()} grupoId={null}
          showToast={showToast}
          onClose={() => setCreando(false)}
          onSaved={() => loadHistorial(alumnoSel)}
        />
      )}
      {/* Modal editar */}
      {editEntrada && (
        <BitacoraFormModal
          alumno={alumnoSel} entrada={editEntrada}
          showToast={showToast}
          onClose={() => setEditEntrada(null)}
          onSaved={() => loadHistorial(alumnoSel)}
        />
      )}
    </div>
  )
}
