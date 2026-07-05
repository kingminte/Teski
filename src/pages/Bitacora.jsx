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
  const [bitacoraRows, setBitacoraRows] = useState([])   // resumen: 1 fila por entrada (para agrupar y contar)
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
    const [{ data: socs }, { data: benes }, { data: bit }] = await Promise.all([
      supabase.from('socios').select('id,nombre,apellido,numero_socio').order('apellido'),
      supabase.from('beneficiarios').select('id,nombre,apellido,socio_id').order('apellido'),
      supabase.from('clases_bitacora').select('participante_tipo,participante_id,socio_id,fecha'),
    ])
    setSocios(socs || [])
    setBeneficiarios(benes || [])
    setBitacoraRows(bit || [])
    setLoadingBase(false)
  }

  // Recarga solo el resumen (para refrescar conteos tras crear/borrar).
  const loadResumen = async () => {
    const { data } = await supabase.from('clases_bitacora').select('participante_tipo,participante_id,socio_id,fecha')
    setBitacoraRows(data || [])
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

  const sociosById = useMemo(() => Object.fromEntries(socios.map(s => [s.id, s])), [socios])
  const partByKey = useMemo(() => {
    const m = {}
    participantes.forEach(p => { m[`${p.participante_tipo}:${p.participante_id}`] = p })
    return m
  }, [participantes])

  // Resumen por alumno: conteo de entradas + última fecha.
  const resumen = useMemo(() => {
    const acc = {}
    bitacoraRows.forEach(r => {
      const k = `${r.participante_tipo}:${r.participante_id}`
      if (!acc[k]) acc[k] = { count: 0, ultima: '' }
      acc[k].count++
      if (r.fecha > acc[k].ultima) acc[k].ultima = r.fecha
    })
    return acc
  }, [bitacoraRows])

  // Enriquecer un participante con su familia (socio padre) y su conteo.
  const enrich = (p) => {
    const soc = sociosById[p.socio_id]
    const r = resumen[`${p.participante_tipo}:${p.participante_id}`]
    return {
      ...p,
      socioNombre: soc ? `${soc.nombre} ${soc.apellido}` : '',
      socioNumero: soc?.numero_socio || '',
      count: r?.count || 0,
      ultima: r?.ultima || '',
    }
  }

  // Lista general por defecto: SOLO alumnos con al menos una entrada, ordenados por nombre.
  const alumnosConFeedback = useMemo(() => (
    Object.keys(resumen)
      .map(k => partByKey[k])
      .filter(Boolean)
      .map(enrich)
      .sort((a, b) => norm(a.nombre).localeCompare(norm(b.nombre)))
  ), [resumen, partByKey, sociosById])

  // Con búsqueda: filtra sobre TODOS los participantes (por nombre de alumno o del socio),
  // así el operador puede además iniciar el primer feedback de alguien sin historial aún.
  const resultados = useMemo(() => {
    const q = norm(search).trim()
    if (!q) return []
    return participantes
      .map(enrich)
      .filter(p => norm(p.nombre).includes(q) || norm(p.socioNombre).includes(q))
      .sort((a, b) => norm(a.nombre).localeCompare(norm(b.nombre)))
      .slice(0, 50)
  }, [search, participantes, resumen, sociosById])

  const buscando = search.trim().length > 0
  const listaMostrada = buscando ? resultados : alumnosConFeedback

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
    loadResumen()
  }

  const onFeedbackGuardado = () => { loadHistorial(alumnoSel); loadResumen() }

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

  const selKey = alumnoSel ? `${alumnoSel.participante_tipo}:${alumnoSel.participante_id}` : null

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      {ToastComponent}

      {/* Lista general de alumnos con feedback + buscador que filtra */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-notebook"></i> Bitácora de feedback</div>
        </div>
        <div style={{ padding: '0.75rem 1.5rem 1rem' }}>
          <div className="search-box">
            <i className="ti ti-search"></i>
            <input placeholder="Filtrar por alumno o socio…"
              value={search} onChange={e => setSearch(e.target.value)} disabled={loadingBase} />
          </div>
        </div>

        {loadingBase ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
        ) : listaMostrada.length === 0 ? (
          <div className="empty-state">
            <i className="ti ti-notebook-off"></i>
            {buscando ? 'Sin resultados.' : 'Aún no hay feedback registrado en el sistema.'}
          </div>
        ) : (
          <div style={{ padding: '0 0 0.5rem' }}>
            {listaMostrada.map(p => {
              const k = `${p.participante_tipo}:${p.participante_id}`
              const familiaTxt = p.participante_tipo === 'beneficiario' && p.socioNombre
                ? ` · Familia: ${p.socioNombre}${p.socioNumero ? ` (N°${p.socioNumero})` : ''}`
                : ''
              return (
                <div key={k} onClick={() => setAlumnoSel(p)}
                  style={{ padding: '10px 1.5rem', borderBottom: '0.5px solid rgba(201,168,76,0.08)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: selKey === k ? 'rgba(201,168,76,0.08)' : 'transparent' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: '#c8d0dc', display: 'flex', alignItems: 'center', gap: 7 }}>
                      <i className={`ti ${p.participante_tipo === 'beneficiario' ? 'ti-baby-carriage' : 'ti-user'}`} style={{ fontSize: 13, color: 'var(--text-muted)' }}></i>
                      {p.nombre}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginTop: 2 }}>{p.sub}{familiaTxt}</div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 5, fontFamily: 'sans-serif',
                    background: p.count > 0 ? 'rgba(201,168,76,0.15)' : 'rgba(127,140,158,0.12)',
                    color: p.count > 0 ? 'var(--gold-light)' : 'var(--text-dim)' }}>
                    {p.count > 0 ? `${p.count} feedback` : 'sin feedback aún'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
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
          onSaved={onFeedbackGuardado}
        />
      )}
      {/* Modal editar */}
      {editEntrada && (
        <BitacoraFormModal
          alumno={alumnoSel} entrada={editEntrada}
          showToast={showToast}
          onClose={() => setEditEntrada(null)}
          onSaved={onFeedbackGuardado}
        />
      )}
    </div>
  )
}
