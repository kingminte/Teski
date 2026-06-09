import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const fmtDiaFecha = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${DIAS[dt.getDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}
const edadDe = (fnac) => {
  if (!fnac) return null
  const [y, m, d] = fnac.split('-').map(Number)
  const hoy = new Date()
  let e = hoy.getFullYear() - y
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) e--
  return e
}

const ESTADO_META = {
  pendiente: { bg: 'rgba(239,159,39,0.15)', color: '#fac775', txt: 'Esperando horario' },
  agendada: { bg: 'rgba(29,158,117,0.15)', color: '#5dcaa5', txt: 'Agendada' },
  cancelada: { bg: 'rgba(127,140,158,0.15)', color: 'var(--text-muted)', txt: 'Cancelada' },
  realizada: { bg: 'rgba(55,138,221,0.15)', color: '#85b7eb', txt: 'Realizada' },
  no_realizada: { bg: 'rgba(163,45,45,0.15)', color: '#f09595', txt: 'No realizada' },
}
const TipoBadge = ({ tipo }) => (
  <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 7px', borderRadius: 4, background: tipo === 'snowboard' ? 'rgba(175,169,236,0.15)' : 'rgba(55,138,221,0.15)', color: tipo === 'snowboard' ? '#afa9ec' : '#85b7eb' }}>
    {tipo === 'snowboard' ? 'Snowboard' : 'Esquí'}
  </span>
)

export default function SolicitarClase() {
  const { showToast, ToastComponent } = useToast()
  const { user } = useAuth()
  // El acceso depende de tener un socio vinculado (socio_id), no del rol:
  // así un admin/gestor que también es socio puede solicitar para su familia.
  const miSocioId = user?.socio_id

  const [socio, setSocio] = useState(null)
  const [beneficiarios, setBeneficiarios] = useState([])      // todos (para resolver nombres)
  const [niveles, setNiveles] = useState([])
  const [disponibilidad, setDisponibilidad] = useState([])
  const [config, setConfig] = useState({ horas_minimas_cancelacion: 2 })
  const [solicitudes, setSolicitudes] = useState([])          // mis solicitudes (enriquecidas)
  const [loading, setLoading] = useState(true)
  const [verHistorico, setVerHistorico] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [fechaSel, setFechaSel] = useState('')
  const [tipoSel, setTipoSel] = useState('esqui')
  const [selecciones, setSelecciones] = useState({})           // { key: { checked, nivel_id } }
  const [enviando, setEnviando] = useState(false)

  const nivelesOrden = niveles.slice().sort((a, b) => a.orden - b.orden)
  const primerNivelId = nivelesOrden[0]?.id || null
  const nivelNombre = (id) => niveles.find(n => n.id === id)?.nombre || '—'

  // Participantes base: socio adulto + beneficiarios vigentes
  const participantesBase = socio ? [
    { key: 'socio:' + socio.id, tipo: 'socio', id: socio.id, nombre: `${socio.nombre} ${socio.apellido}`, edad: null, nivel_esqui_id: socio.nivel_esqui_id, nivel_snowboard_id: socio.nivel_snowboard_id },
    ...beneficiarios.filter(b => b.estado === 'vigente').map(b => ({
      key: 'beneficiario:' + b.id, tipo: 'beneficiario', id: b.id,
      nombre: `${b.nombre} ${b.apellido}`, edad: edadDe(b.fecha_nacimiento),
      nivel_esqui_id: b.nivel_esqui_id, nivel_snowboard_id: b.nivel_snowboard_id,
    })),
  ] : []

  useEffect(() => { if (miSocioId) loadAll() }, [miSocioId])

  const loadAll = async () => {
    setLoading(true)
    const [{ data: soc }, { data: benes }, { data: nivs }, { data: disp }, { data: cfg }] = await Promise.all([
      supabase.from('socios').select('id,nombre,apellido,nivel_esqui_id,nivel_snowboard_id').eq('id', miSocioId).maybeSingle(),
      supabase.from('beneficiarios').select('*').eq('socio_id', miSocioId),
      supabase.from('clases_niveles').select('*').eq('activo', true).order('orden'),
      supabase.from('clases_disponibilidad').select('*').gte('fecha', hoyISO()).order('fecha'),
      supabase.from('clases_config').select('*').eq('id', 1).maybeSingle(),
    ])
    setSocio(soc || null)
    setBeneficiarios(benes || [])
    setNiveles(nivs || [])
    setDisponibilidad(disp || [])
    if (cfg) setConfig(cfg)
    await loadSolicitudes(soc, benes || [])
    setLoading(false)
  }

  const loadSolicitudes = async (soc, benes) => {
    const { data: sols } = await supabase.from('clases_solicitudes').select('*').eq('socio_id', miSocioId).order('fecha', { ascending: false })
    const lista = sols || []

    // Grupos vinculados (hora, profesor) + compañeros
    const grupoIds = [...new Set(lista.filter(s => s.grupo_id).map(s => s.grupo_id))]
    let grupos = [], grupoSols = []
    if (grupoIds.length) {
      const [{ data: g }, { data: gs }] = await Promise.all([
        supabase.from('clases_grupos').select('*, clases_profesores(nombre)').in('id', grupoIds),
        supabase.from('clases_solicitudes').select('id,grupo_id,participante_tipo,participante_id,estado').in('grupo_id', grupoIds),
      ])
      grupos = g || []; grupoSols = gs || []
    }

    // Resolver nombres de compañeros (pueden ser de otras familias)
    const nombreMap = await resolverNombres([...lista, ...grupoSols], soc, benes)

    const enriquecidas = lista.map(s => {
      const grupo = grupos.find(g => g.id === s.grupo_id)
      const companeros = grupoSols
        .filter(gs => gs.grupo_id === s.grupo_id && gs.id !== s.id && gs.estado !== 'cancelada')
        .map(gs => nombreMap[gs.participante_id] || 'Participante')
      return { ...s, nombre: nombreMap[s.participante_id] || 'Participante', grupo, companeros }
    })
    setSolicitudes(enriquecidas)
  }

  // Construye un mapa participante_id -> nombre, resolviendo socios y beneficiarios por lote.
  const resolverNombres = async (sols, soc, benes) => {
    const map = {}
    if (soc) map[soc.id] = `${soc.nombre} ${soc.apellido}`
    ;(benes || []).forEach(b => { map[b.id] = `${b.nombre} ${b.apellido}` })
    const socioIds = [...new Set(sols.filter(s => s.participante_tipo === 'socio').map(s => s.participante_id).filter(id => !map[id]))]
    const beneIds = [...new Set(sols.filter(s => s.participante_tipo === 'beneficiario').map(s => s.participante_id).filter(id => !map[id]))]
    if (socioIds.length) {
      const { data } = await supabase.from('socios').select('id,nombre,apellido').in('id', socioIds)
      ;(data || []).forEach(s => { map[s.id] = `${s.nombre} ${s.apellido}` })
    }
    if (beneIds.length) {
      const { data } = await supabase.from('beneficiarios').select('id,nombre,apellido').in('id', beneIds)
      ;(data || []).forEach(b => { map[b.id] = `${b.nombre} ${b.apellido}` })
    }
    return map
  }

  // ----- Modal -----
  const nivelDefault = (p, tipo) => (tipo === 'esqui' ? p.nivel_esqui_id : p.nivel_snowboard_id) || primerNivelId
  const initSelecciones = (tipo) => {
    const sel = {}
    participantesBase.forEach(p => { sel[p.key] = { checked: false, nivel_id: nivelDefault(p, tipo) } })
    return sel
  }
  const openModal = () => {
    const f = disponibilidad[0]?.fecha || ''
    setFechaSel(f); setTipoSel('esqui'); setSelecciones(initSelecciones('esqui')); setShowModal(true)
  }
  const cambiarTipo = (tipo) => {
    setTipoSel(tipo)
    // Refrescar el nivel de cada participante a la disciplina nueva
    setSelecciones(prev => {
      const next = {}
      participantesBase.forEach(p => { next[p.key] = { checked: prev[p.key]?.checked || false, nivel_id: nivelDefault(p, tipo) } })
      return next
    })
  }
  const toggleParticipante = (key) => setSelecciones(prev => ({ ...prev, [key]: { ...prev[key], checked: !prev[key].checked } }))
  const setNivelParticipante = (key, nivel_id) => setSelecciones(prev => ({ ...prev, [key]: { ...prev[key], nivel_id } }))

  const seleccionados = participantesBase.filter(p => selecciones[p.key]?.checked)

  const handleSubmit = async () => {
    if (!fechaSel) { showToast('Elige un día', 'error'); return }
    if (seleccionados.length === 0) { showToast('Selecciona al menos un participante', 'error'); return }

    // Pre-check de duplicados (para mensaje con nombre); el RPC es la red atómica.
    const dup = seleccionados.find(p => solicitudes.some(s =>
      s.participante_id === p.id && s.fecha === fechaSel && s.tipo === tipoSel && ['pendiente', 'agendada'].includes(s.estado)))
    if (dup) { showToast(`Ya hay una solicitud activa para ${dup.nombre} el ${fmtDiaFecha(fechaSel)}`, 'error'); return }

    setEnviando(true)
    const participantes = seleccionados.map(p => ({ tipo: p.tipo, id: p.id, nivel_id: selecciones[p.key].nivel_id }))
    const { error } = await supabase.rpc('crear_solicitudes_clase', {
      p_socio_id: miSocioId, p_fecha: fechaSel, p_tipo: tipoSel, p_participantes: participantes,
    })
    setEnviando(false)
    if (error) {
      const m = error.message || ''
      if (m.includes('solicitud_duplicada:')) {
        const id = m.split('solicitud_duplicada:')[1].trim()
        const nom = participantesBase.find(p => p.id === id)?.nombre || 'un participante'
        showToast(`Ya hay una solicitud activa para ${nom} el ${fmtDiaFecha(fechaSel)}`, 'error')
      } else {
        showToast('Error al enviar la solicitud: ' + m, 'error')
      }
      return
    }
    showToast('Solicitud enviada. Andacor te confirmará el horario.')
    setShowModal(false)
    loadAll()
  }

  const puedeCancelar = (sol) => {
    if (!['pendiente', 'agendada'].includes(sol.estado)) return false
    const horasMin = config.horas_minimas_cancelacion ?? 2
    if (horasMin <= 0) return true // sin restricción de tiempo
    const [y, m, d] = sol.fecha.split('-').map(Number)
    // Agendada con grupo: contra hora_inicio. Pendiente (o sin hora): contra medianoche.
    let ref
    if (sol.estado === 'agendada' && sol.grupo?.hora_inicio) {
      const [hh, mm] = sol.grupo.hora_inicio.split(':').map(Number)
      ref = new Date(y, m - 1, d, hh, mm || 0, 0)
    } else {
      ref = new Date(y, m - 1, d, 0, 0, 0)
    }
    const limite = new Date(ref.getTime() - horasMin * 3600 * 1000)
    return new Date() < limite
  }
  const tooltipCancelar = (sol) => {
    const n = config.horas_minimas_cancelacion ?? 2
    return sol.estado === 'agendada'
      ? `Cancelación solo permitida hasta ${n} horas antes del inicio de la clase.`
      : `Cancelación solo permitida hasta ${n} horas antes de la clase.`
  }
  const handleCancelar = async (sol) => {
    if (!confirm(`¿Cancelar la solicitud para ${sol.nombre} del ${fmtDiaFecha(sol.fecha)}?`)) return
    const { error } = await supabase.from('clases_solicitudes').update({ estado: 'cancelada' }).eq('id', sol.id)
    if (error) showToast('Error al cancelar: ' + error.message, 'error')
    else { showToast('Solicitud cancelada'); loadAll() }
  }

  // ----- Render -----
  if (!miSocioId) {
    return (
      <div className="card">
        <div className="empty-state">
          <i className="ti ti-ski-jumping" style={{ color: 'var(--gold-dim)' }}></i>
          Tu usuario no está vinculado a un socio del club. Si necesitas gestionar solicitudes, ve a <strong style={{ marginLeft: 4 }}>Gestionar clases</strong>.
        </div>
      </div>
    )
  }

  const solsVisibles = verHistorico ? solicitudes : solicitudes.filter(s => s.fecha >= hoyISO())

  return (
    <div>
      {ToastComponent}

      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-ski-jumping"></i> Clases de esquí</div>
          <button className="btn btn-primary btn-sm" onClick={openModal} disabled={loading}>
            <i className="ti ti-plus"></i> Nueva solicitud
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-list-check"></i> Mis solicitudes</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', cursor: 'pointer' }}>
            <input type="checkbox" checked={verHistorico} onChange={e => setVerHistorico(e.target.checked)} /> Ver histórico
          </label>
        </div>
        {loading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
        ) : solsVisibles.length === 0 ? (
          <div className="empty-state"><i className="ti ti-calendar-off"></i>{verHistorico ? 'No tienes solicitudes.' : 'No tienes solicitudes próximas.'}</div>
        ) : (
          <div style={{ padding: '0.5rem 0' }}>
            {solsVisibles.map(s => {
              const meta = ESTADO_META[s.estado] || ESTADO_META.pendiente
              const cancelable = puedeCancelar(s)
              return (
                <div key={s.id} style={{ borderBottom: '0.5px solid rgba(201,168,76,0.08)', padding: '0.9rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, color: '#c8d0dc', fontWeight: 500 }}>{s.nombre}</span>
                      <TipoBadge tipo={s.tipo} />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>{fmtDiaFecha(s.fecha)}</span>
                    </div>
                    {s.estado === 'agendada' && s.grupo && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                        <i className="ti ti-clock" style={{ fontSize: 12 }}></i> {(s.grupo.hora_inicio || '').slice(0, 5)}–{(s.grupo.hora_fin || '').slice(0, 5)}
                        {s.grupo.clases_profesores?.nombre && <> · Profesor: {s.grupo.clases_profesores.nombre}</>}
                        {s.companeros.length > 0 && <> · Con: {s.companeros.join(', ')}</>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: meta.bg, color: meta.color }}>{meta.txt}</span>
                    {['pendiente', 'agendada'].includes(s.estado) && (
                      <button className="btn btn-sm" disabled={!cancelable}
                        style={{ color: cancelable ? '#f09595' : 'var(--text-dim)', borderColor: cancelable ? 'rgba(240,149,149,0.4)' : 'var(--border)', fontSize: 11 }}
                        onClick={() => cancelable && handleCancelar(s)}
                        title={cancelable ? 'Cancelar solicitud' : tooltipCancelar(s)}>
                        <i className="ti ti-x"></i> Cancelar
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal Nueva solicitud */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ width: 560, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">Nueva solicitud de clase</div>
              <button className="btn btn-sm" onClick={() => setShowModal(false)}><i className="ti ti-x"></i></button>
            </div>

            {disponibilidad.length === 0 ? (
              <div className="empty-state"><i className="ti ti-calendar-off"></i>Andacor todavía no publicó fechas disponibles.</div>
            ) : (
              <div style={{ padding: '0.5rem 1rem 1rem' }}>
                <div className="form-group full" style={{ marginBottom: 14 }}>
                  <label>Día</label>
                  <select value={fechaSel} onChange={e => setFechaSel(e.target.value)}>
                    {disponibilidad.map(d => <option key={d.id} value={d.fecha}>{fmtDiaFecha(d.fecha)}{d.notas ? ` — ${d.notas}` : ''}</option>)}
                  </select>
                </div>

                <div className="form-group full" style={{ marginBottom: 14 }}>
                  <label>Tipo</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[{ v: 'esqui', l: 'Esquí', i: 'ti-ski-jumping' }, { v: 'snowboard', l: 'Snowboard', i: 'ti-snowboarding' }].map(t => (
                      <button key={t.v} onClick={() => cambiarTipo(t.v)} style={{
                        flex: 1, padding: '10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'sans-serif', fontSize: 13,
                        border: `1px solid ${tipoSel === t.v ? 'var(--gold)' : 'var(--border)'}`,
                        background: tipoSel === t.v ? 'rgba(201,168,76,0.12)' : 'transparent',
                        color: tipoSel === t.v ? 'var(--gold-light)' : 'var(--text-muted)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}>
                        <i className={`ti ${t.i}`}></i> {t.l}
                      </button>
                    ))}
                  </div>
                </div>

                <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif' }}>Participantes</label>
                <div style={{ marginTop: 6, border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  {participantesBase.map(p => {
                    const sel = selecciones[p.key] || {}
                    return (
                      <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '0.5px solid rgba(201,168,76,0.08)', background: sel.checked ? 'rgba(29,158,117,0.06)' : 'transparent' }}>
                        <input type="checkbox" checked={!!sel.checked} onChange={() => toggleParticipante(p.key)} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: '#c8d0dc' }}>{p.nombre}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
                            {p.tipo === 'socio' ? 'Socio' : 'Beneficiario'}{p.edad != null ? ` · ${p.edad} años` : ''}
                          </div>
                        </div>
                        <select value={sel.nivel_id || ''} onChange={e => setNivelParticipante(p.key, e.target.value)} disabled={!sel.checked}
                          style={{ width: 'auto', fontSize: 12, padding: '4px 6px' }}>
                          {nivelesOrden.map(n => <option key={n.id} value={n.id}>{n.nombre}</option>)}
                        </select>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="modal-footer">
              <button className="btn" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={enviando || disponibilidad.length === 0 || seleccionados.length === 0}>
                {enviando ? <><i className="ti ti-loader"></i> Enviando…</> : <><i className="ti ti-check"></i> Enviar solicitud{seleccionados.length > 0 ? ` (${seleccionados.length})` : ''}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
