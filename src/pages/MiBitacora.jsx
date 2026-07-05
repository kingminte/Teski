import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/useAuth'

// Fecha ISO → dd/mm/yyyy (regla del proyecto: nunca new Date() para formatear).
const fmtFecha = (iso) => (iso ? iso.split('-').reverse().join('/') : '')

// Vista del PADRE (rol socio): lee el feedback de SU familia. 100% lectura.
// El aislamiento entre familias se apoya EN socio_id (clave de familia), nunca
// en participante_id: la query filtra por socio_id = user.socio_id, así que solo
// trae el feedback del socio y de sus beneficiarios. Sin escritura/edición/borrado.
export default function MiBitacora() {
  const { user } = useAuth()
  const miSocioId = user?.socio_id

  const [entradas, setEntradas] = useState([])
  const [nombreMap, setNombreMap] = useState({})   // participante_id -> nombre
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (miSocioId) load() }, [miSocioId])

  const load = async () => {
    setLoading(true)
    // Query única a prueba de fugas: SOLO la familia del socio logueado.
    const { data: ents } = await supabase.from('clases_bitacora')
      .select('*')
      .eq('socio_id', miSocioId)
      .order('fecha', { ascending: false })

    // Resolver nombres del socio titular + sus beneficiarios (la familia).
    const [{ data: soc }, { data: benes }] = await Promise.all([
      supabase.from('socios').select('id,nombre,apellido').eq('id', miSocioId).maybeSingle(),
      supabase.from('beneficiarios').select('id,nombre,apellido').eq('socio_id', miSocioId),
    ])
    const map = {}
    if (soc) map[soc.id] = `${soc.nombre} ${soc.apellido}`
    ;(benes || []).forEach(b => { map[b.id] = `${b.nombre} ${b.apellido}` })

    setNombreMap(map)
    setEntradas(ents || [])
    setLoading(false)
  }

  if (!miSocioId) {
    return (
      <div className="card">
        <div className="empty-state">
          <i className="ti ti-notebook" style={{ color: 'var(--gold-dim)' }}></i>
          Tu usuario no está vinculado a un socio del club, por lo que no tiene bitácora de clases.
        </div>
      </div>
    )
  }

  // Agrupar por alumno (participante_tipo + participante_id), conservando el
  // orden por fecha desc dentro de cada grupo (la query ya viene ordenada).
  const grupos = []
  for (const e of entradas) {
    const key = `${e.participante_tipo}:${e.participante_id}`
    let g = grupos.find(x => x.key === key)
    if (!g) {
      const esTitular = e.participante_tipo === 'socio' && e.participante_id === miSocioId
      g = {
        key,
        nombre: nombreMap[e.participante_id] || 'Participante',
        etiqueta: esTitular ? 'Tú (socio titular)' : (e.participante_tipo === 'beneficiario' ? 'Beneficiario' : 'Socio'),
        esTitular,
        entradas: [],
      }
      grupos.push(g)
    }
    g.entradas.push(e)
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-notebook"></i> Feedback de clases</div>
        </div>
        <div style={{ padding: '0 1.5rem 0.5rem', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
          Observaciones que la escuela dejó para tu familia. Solo lectura.
        </div>
      </div>

      {loading ? (
        <div className="card"><div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div></div>
      ) : grupos.length === 0 ? (
        <div className="card"><div className="empty-state"><i className="ti ti-notebook-off"></i>Aún no hay feedback registrado para tu familia.</div></div>
      ) : (
        grupos.map(g => (
          <div key={g.key} className="card">
            <div className="card-header">
              <div className="card-title">
                <i className={`ti ${g.esTitular ? 'ti-user' : 'ti-baby-carriage'}`}></i>
                {g.nombre}
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginLeft: 8 }}>{g.etiqueta}</span>
              </div>
            </div>
            <div style={{ padding: '0.5rem 0' }}>
              {g.entradas.map(e => {
                const editado = !!e.updated_by
                return (
                  <div key={e.id} style={{ borderBottom: '0.5px solid rgba(201,168,76,0.08)', padding: '0.9rem 1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: 'var(--gold-light)', fontFamily: 'sans-serif', fontWeight: 600 }}>{fmtFecha(e.fecha)}</span>
                      {editado && <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'sans-serif', fontStyle: 'italic' }}>· editado</span>}
                    </div>
                    <div style={{ fontSize: 13.5, color: '#c8d0dc', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{e.comentario}</div>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
