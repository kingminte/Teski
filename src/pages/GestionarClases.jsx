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
const hhmm = (t) => (t || '').slice(0, 5)
// Duración en horas derivada de hora_inicio/hora_fin (no hay campo duración).
const duracionHorasDe = (g) => {
  const toMin = (t) => { const [h, m] = (t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
  return Math.max(0, Math.round(((toMin(g.hora_fin) - toMin(g.hora_inicio)) / 60) * 10) / 10)
}
const fmtHoras = (h) => (Number.isInteger(h) ? String(h) : String(h).replace('.', ','))
const labelHoras = (h) => `${fmtHoras(h)} hora${h === 1 ? '' : 's'}-profesor`

const TipoBadge = ({ tipo }) => (
  <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 7px', borderRadius: 4, background: tipo === 'snowboard' ? 'rgba(175,169,236,0.15)' : 'rgba(55,138,221,0.15)', color: tipo === 'snowboard' ? '#afa9ec' : '#85b7eb' }}>
    {tipo === 'snowboard' ? 'Snowboard' : 'Esquí'}
  </span>
)

const EMPTY_GRUPO = { hora_inicio: '10:00', hora_fin: '12:00', profesor_id: '', comentario: '' }

export default function GestionarClases() {
  const { showToast, ToastComponent } = useToast()
  const { puedeEditar, user } = useAuth()
  const editable = puedeEditar('clases_gestion')

  const [disponibilidad, setDisponibilidad] = useState([])
  const [fechaSel, setFechaSel] = useState('')
  const [profesores, setProfesores] = useState([])
  const [niveles, setNiveles] = useState([])
  const [solicitudes, setSolicitudes] = useState([])   // de la fecha, enriquecidas
  const [grupos, setGrupos] = useState([])              // de la fecha, con profesor
  const [asistencias, setAsistencias] = useState({})    // solicitud_id -> { asistio, comentario }
  const [loading, setLoading] = useState(true)

  // Marcar realizada
  const [marcarGrupo, setMarcarGrupo] = useState(null)   // grupo en el modal de asistencia
  const [asistenciaForm, setAsistenciaForm] = useState({}) // solicitud_id -> { asistio, comentario }
  const [guardandoMarcar, setGuardandoMarcar] = useState(false)

  // Agrupar
  const [agruparSol, setAgruparSol] = useState(null)
  const [agruparModo, setAgruparModo] = useState('nuevo')
  const [agruparGrupoId, setAgruparGrupoId] = useState('')
  const [nuevoGrupo, setNuevoGrupo] = useState(EMPTY_GRUPO)
  const [guardandoAgrupar, setGuardandoAgrupar] = useState(false)

  // Editar grupo
  const [editGrupo, setEditGrupo] = useState(null)
  const [formEdit, setFormEdit] = useState(EMPTY_GRUPO)
  const [guardandoEdit, setGuardandoEdit] = useState(false)

  // Dividir grupo (mover varios alumnos a un grupo nuevo)
  const [dividirGrupo, setDividirGrupo] = useState(null)   // grupo origen (agendada)
  const [dividirSel, setDividirSel] = useState({})         // solicitud_id -> bool (van al grupo nuevo)
  const [dividirForm, setDividirForm] = useState(EMPTY_GRUPO)
  const [guardandoDividir, setGuardandoDividir] = useState(false)

  const nivelNombre = (id) => niveles.find(n => n.id === id)?.nombre || '—'

  useEffect(() => { loadBase() }, [])
  useEffect(() => { if (fechaSel) loadFecha(fechaSel) }, [fechaSel])

  const loadBase = async () => {
    const [{ data: disp }, { data: profs }, { data: nivs }] = await Promise.all([
      supabase.from('clases_disponibilidad').select('*').order('fecha'),
      supabase.from('clases_profesores').select('*').eq('activo', true).order('nombre'),
      supabase.from('clases_niveles').select('*').order('orden'),
    ])
    setDisponibilidad(disp || [])
    setProfesores(profs || [])
    setNiveles(nivs || [])
    const hoy = hoyISO()
    const futura = (disp || []).find(d => d.fecha >= hoy)
    const inicial = (futura || (disp || [])[(disp || []).length - 1] || {}).fecha || ''
    setFechaSel(inicial)
    if (!inicial) setLoading(false)
  }

  const loadFecha = async (fecha) => {
    setLoading(true)
    const [{ data: sols }, { data: grps }] = await Promise.all([
      supabase.from('clases_solicitudes').select('*').eq('fecha', fecha),
      supabase.from('clases_grupos').select('*, clases_profesores(nombre)').eq('fecha', fecha).order('hora_inicio'),
    ])
    const lista = sols || []
    const nombreMap = await resolverNombres(lista)
    const enriquecidas = lista.map(s => ({
      ...s,
      participanteNombre: nombreMap[s.participante_id] || 'Participante',
      socioNombre: nombreMap[s.socio_id] || 'Socio',
    }))

    // Asistencia de las clases ya marcadas (para mostrar quién asistió/faltó)
    const grupoIds = (grps || []).map(g => g.id)
    const asisMap = {}
    if (grupoIds.length) {
      const { data: asis } = await supabase.from('clases_asistencia').select('*').in('grupo_id', grupoIds)
      ;(asis || []).forEach(a => { asisMap[a.solicitud_id] = a })
    }

    setSolicitudes(enriquecidas)
    setGrupos(grps || [])
    setAsistencias(asisMap)
    setLoading(false)
  }

  const resolverNombres = async (sols) => {
    const socioIds = new Set(), beneIds = new Set()
    sols.forEach(s => {
      socioIds.add(s.socio_id)
      if (s.participante_tipo === 'socio') socioIds.add(s.participante_id)
      else beneIds.add(s.participante_id)
    })
    const map = {}
    if (socioIds.size) {
      const { data } = await supabase.from('socios').select('id,nombre,apellido').in('id', [...socioIds])
      ;(data || []).forEach(s => { map[s.id] = `${s.nombre} ${s.apellido}` })
    }
    if (beneIds.size) {
      const { data } = await supabase.from('beneficiarios').select('id,nombre,apellido').in('id', [...beneIds])
      ;(data || []).forEach(b => { map[b.id] = `${b.nombre} ${b.apellido}` })
    }
    return map
  }

  // Derivados
  const pendientes = solicitudes.filter(s => !s.grupo_id && s.estado === 'pendiente')
  const rosterDe = (grupoId) => solicitudes.filter(s => s.grupo_id === grupoId && s.estado !== 'cancelada')

  // Stats del día
  // Estudiantes: agendados (sin marcar) + los que asistieron en clases realizadas
  // (un participante con estado 'realizada' = asistió a una clase realizada).
  const estudiantesHoy = solicitudes.filter(s => s.estado === 'agendada' || s.estado === 'realizada').length
  // Horas-profesor: realizadas (cobradas) + agendadas (proyectado). No_realizada no cuenta.
  const horasProfesor = grupos.filter(g => ['realizada', 'agendada'].includes(g.estado)).reduce((t, g) => t + duracionHorasDe(g), 0)
  const realizadasHoy = grupos.filter(g => g.estado === 'realizada').length

  // ¿Puede revertir? Mismo día: andacor/admin/gestor (editable). Días anteriores: solo admin. Lector nunca.
  const puedeDesmarcar = (g) => {
    if (!editable) return false
    if (g.fecha === hoyISO()) return ['andacor', 'admin', 'gestor'].includes(user?.rol)
    return user?.rol === 'admin'
  }

  // ----- Agrupar / Mover -----
  // Destinos válidos para una solicitud: mismo tipo, solo grupos 'agendada'
  // y (al mover) excluyendo el grupo origen. Sirve para agrupar un pendiente
  // y para mover un alumno del roster de un grupo agendada a otro.
  const gruposDestinoDe = (sol) => grupos.filter(g => g.tipo === sol.tipo && g.estado === 'agendada' && g.id !== sol.grupo_id)
  const openAgrupar = (sol) => {
    const destinos = gruposDestinoDe(sol)
    setAgruparSol(sol)
    setAgruparModo(destinos.length > 0 ? 'existente' : 'nuevo')
    setAgruparGrupoId(destinos[0]?.id || '')
    setNuevoGrupo(EMPTY_GRUPO)
  }
  // Detecta si el profesor ya tiene otra clase que solapa en horario el mismo día.
  // Tiempos normalizados a minutos para comparar HH:MM (form) con HH:MM:SS (base).
  // Solape estricto [ini, fin): contiguas (10-11 y 11-12) NO solapan.
  const detectarConflictoProfesor = ({ profesorId, horaIni, horaFin, fecha, excludeId = null }) => {
    if (!profesorId) return null
    const toMin = (t) => { const [h, m] = (t || '').split(':'); return (+h) * 60 + (+m || 0) }
    const iniN = toMin(horaIni), finN = toMin(horaFin)
    return grupos.find(g =>
      g.id !== excludeId &&
      g.profesor_id === profesorId &&
      g.fecha === fecha &&
      ['agendada', 'realizada', 'no_realizada'].includes(g.estado) &&
      toMin(g.hora_inicio) < finN && iniN < toMin(g.hora_fin)
    ) || null
  }
  const msgConflicto = (g) => {
    const tipoLabel = g.tipo === 'snowboard' ? 'snowboard' : 'esquí'
    const nombre = g.clases_profesores?.nombre || 'asignado'
    return `El profesor ${nombre} ya tiene una clase de ${tipoLabel} de ${hhmm(g.hora_inicio)}–${hhmm(g.hora_fin)} en esta fecha. Cambia el horario o el profesor.`
  }

  const handleConfirmarAgrupar = async () => {
    const sol = agruparSol
    const moviendo = !!sol.grupo_id
    setGuardandoAgrupar(true)
    try {
      let grupoId = agruparGrupoId
      if (agruparModo === 'nuevo') {
        if (!nuevoGrupo.hora_inicio || !nuevoGrupo.hora_fin) { showToast('Indica hora de inicio y fin', 'error'); setGuardandoAgrupar(false); return }
        const conflicto = detectarConflictoProfesor({ profesorId: nuevoGrupo.profesor_id || null, horaIni: nuevoGrupo.hora_inicio, horaFin: nuevoGrupo.hora_fin, fecha: sol.fecha })
        if (conflicto) { showToast(msgConflicto(conflicto), 'error'); setGuardandoAgrupar(false); return }
        const { data, error } = await supabase.from('clases_grupos').insert({
          fecha: sol.fecha, hora_inicio: nuevoGrupo.hora_inicio, hora_fin: nuevoGrupo.hora_fin,
          tipo: sol.tipo, profesor_id: nuevoGrupo.profesor_id || null, comentario: nuevoGrupo.comentario || null, estado: 'agendada',
        }).select().single()
        if (error) throw new Error(error.message)
        grupoId = data.id
      }
      if (!grupoId) { showToast('Elige o crea un grupo', 'error'); setGuardandoAgrupar(false); return }
      const { error: e2 } = await supabase.from('clases_solicitudes').update({ grupo_id: grupoId, estado: 'agendada' }).eq('id', sol.id)
      if (e2) throw new Error(e2.message)
      showToast(moviendo ? 'Alumno movido' : 'Solicitud agendada')
      setAgruparSol(null)
      loadFecha(fechaSel)
    } catch (e) {
      showToast('Error al ' + (moviendo ? 'mover' : 'agrupar') + ': ' + e.message, 'error')
    }
    setGuardandoAgrupar(false)
  }

  // ----- Editar / eliminar grupo -----
  const openEditGrupo = (g) => {
    setEditGrupo(g)
    setFormEdit({ hora_inicio: hhmm(g.hora_inicio), hora_fin: hhmm(g.hora_fin), profesor_id: g.profesor_id || '', comentario: g.comentario || '' })
  }
  const handleGuardarEdit = async () => {
    const conflicto = detectarConflictoProfesor({ profesorId: formEdit.profesor_id || null, horaIni: formEdit.hora_inicio, horaFin: formEdit.hora_fin, fecha: editGrupo.fecha, excludeId: editGrupo.id })
    if (conflicto) { showToast(msgConflicto(conflicto), 'error'); return }
    setGuardandoEdit(true)
    const { error } = await supabase.from('clases_grupos').update({
      hora_inicio: formEdit.hora_inicio, hora_fin: formEdit.hora_fin,
      profesor_id: formEdit.profesor_id || null, comentario: formEdit.comentario || null,
    }).eq('id', editGrupo.id)
    setGuardandoEdit(false)
    if (error) showToast('Error al guardar: ' + error.message, 'error')
    else { showToast('Grupo actualizado'); setEditGrupo(null); loadFecha(fechaSel) }
  }
  const handleEliminarGrupo = async (g) => {
    if (!confirm('¿Eliminar este grupo? Las solicitudes vuelven a "pendiente" para reagrupar.')) return
    const { error: e1 } = await supabase.from('clases_solicitudes').update({ grupo_id: null, estado: 'pendiente' }).eq('grupo_id', g.id)
    if (e1) { showToast('Error al soltar solicitudes: ' + e1.message, 'error'); return }
    const { error: e2 } = await supabase.from('clases_grupos').delete().eq('id', g.id)
    if (e2) { showToast('Error al eliminar grupo: ' + e2.message, 'error'); return }
    showToast('Grupo eliminado')
    loadFecha(fechaSel)
  }

  // ----- Dividir grupo (solo agendada) -----
  // Crea un 2º grupo agendada (hereda tipo/horario/profesor del original, editable)
  // y mueve las solicitudes seleccionadas a él. Reusa detectarConflictoProfesor.
  const openDividir = (g) => {
    setDividirGrupo(g)
    setDividirSel({})
    setDividirForm({ hora_inicio: hhmm(g.hora_inicio), hora_fin: hhmm(g.hora_fin), profesor_id: g.profesor_id || '', comentario: g.comentario || '' })
  }
  const toggleDividirSel = (solId) => setDividirSel(prev => ({ ...prev, [solId]: !prev[solId] }))

  const handleConfirmarDividir = async () => {
    const g = dividirGrupo
    const roster = rosterDe(g.id)
    const seleccionados = roster.filter(r => dividirSel[r.id])
    if (seleccionados.length === 0) { showToast('Selecciona al menos un alumno para el nuevo grupo', 'error'); return }
    if (seleccionados.length === roster.length) { showToast('Deja al menos un alumno en el grupo original', 'error'); return }
    if (!dividirForm.hora_inicio || !dividirForm.hora_fin) { showToast('Indica hora de inicio y fin', 'error'); return }
    // Mismo profesor y horario que el original solaparía con el propio original → conflicto real (no se puede clonar).
    const conflicto = detectarConflictoProfesor({ profesorId: dividirForm.profesor_id || null, horaIni: dividirForm.hora_inicio, horaFin: dividirForm.hora_fin, fecha: g.fecha })
    if (conflicto) { showToast(msgConflicto(conflicto), 'error'); return }
    setGuardandoDividir(true)
    try {
      const { data, error } = await supabase.from('clases_grupos').insert({
        fecha: g.fecha, hora_inicio: dividirForm.hora_inicio, hora_fin: dividirForm.hora_fin,
        tipo: g.tipo, profesor_id: dividirForm.profesor_id || null, comentario: dividirForm.comentario || null, estado: 'agendada',
      }).select().single()
      if (error) throw new Error(error.message)
      const { error: e2 } = await supabase.from('clases_solicitudes').update({ grupo_id: data.id, estado: 'agendada' }).in('id', seleccionados.map(s => s.id))
      if (e2) throw new Error(e2.message)
      showToast(`Grupo dividido: ${seleccionados.length} alumno${seleccionados.length === 1 ? '' : 's'} al nuevo grupo`)
      setDividirGrupo(null)
      loadFecha(fechaSel)
    } catch (e) {
      showToast('Error al dividir: ' + e.message, 'error')
    }
    setGuardandoDividir(false)
  }

  // ----- Marcar realizada / desmarcar -----
  const openMarcar = (g) => {
    const roster = rosterDe(g.id)
    const form = {}
    roster.forEach(s => { form[s.id] = { asistio: true, comentario: '' } })
    setAsistenciaForm(form)
    setMarcarGrupo(g)
  }
  const toggleAsistio = (solId) => setAsistenciaForm(prev => ({ ...prev, [solId]: { ...prev[solId], asistio: !prev[solId].asistio } }))

  const handleConfirmarMarcar = async () => {
    const roster = rosterDe(marcarGrupo.id)
    const asistenciasArr = roster.map(s => ({
      solicitud_id: s.id,
      asistio: !!asistenciaForm[s.id]?.asistio,
      comentario: asistenciaForm[s.id]?.comentario || null,
    }))
    setGuardandoMarcar(true)
    const { error } = await supabase.rpc('marcar_clase_realizada', {
      p_grupo_id: marcarGrupo.id, p_asistencias: asistenciasArr, p_usuario_id: user?.id || null,
    })
    setGuardandoMarcar(false)
    if (error) { showToast('Error al marcar la clase: ' + error.message, 'error'); return }
    const algunoAsistio = asistenciasArr.some(a => a.asistio)
    showToast(algunoAsistio ? 'Clase marcada como realizada' : 'Clase marcada como no realizada (nadie asistió)')
    setMarcarGrupo(null)
    loadFecha(fechaSel)
  }

  const handleDesmarcar = async (g) => {
    if (!confirm('¿Revertir la clase a "Agendada"? Se borrará el registro de asistencia.')) return
    const { error } = await supabase.rpc('revertir_clase_realizada', { p_grupo_id: g.id, p_usuario_id: user?.id || null })
    if (error) { showToast('Error al revertir: ' + error.message, 'error'); return }
    showToast('Clase revertida a agendada')
    loadFecha(fechaSel)
  }

  const gruposDestino = agruparSol ? gruposDestinoDe(agruparSol) : []
  const esMover = !!agruparSol?.grupo_id

  if (disponibilidad.length === 0 && !loading) {
    return (
      <div className="card">
        <div className="empty-state"><i className="ti ti-calendar-off"></i>No hay fechas de disponibilidad publicadas. Publica fechas en Gestión Escuela → Disponibilidad.</div>
      </div>
    )
  }

  return (
    <div>
      {ToastComponent}

      {/* Header con selector de fecha */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-clipboard-list"></i> Gestión de clases</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Fecha:</span>
            <select value={fechaSel} onChange={e => setFechaSel(e.target.value)} style={{ width: 'auto', fontSize: 13 }}>
              {disponibilidad.map(d => <option key={d.id} value={d.fecha}>{fmtDiaFecha(d.fecha)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {!editable && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginBottom: 8 }}>
          <i className="ti ti-eye"></i> Modo solo lectura.
        </div>
      )}

      {loading ? (
        <div className="card"><div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div></div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
            {/* COLUMNA IZQUIERDA — pendientes */}
            <div className="card">
              <div className="card-header"><div className="card-title"><i className="ti ti-hourglass"></i> Solicitudes pendientes ({pendientes.length})</div></div>
              {pendientes.length === 0 ? (
                <div className="empty-state"><i className="ti ti-checks"></i>No hay solicitudes pendientes para esta fecha.</div>
              ) : (
                <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {pendientes.map(s => (
                    <div key={s.id} style={{ border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.7rem 0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, color: '#c8d0dc', fontWeight: 500 }}>{s.participanteNombre}</span>
                          <TipoBadge tipo={s.tipo} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                          {s.participante_tipo === 'beneficiario' ? `Hijo/a de ${s.socioNombre}` : 'Socio titular'} · Nivel: {nivelNombre(s.nivel_id)}
                        </div>
                      </div>
                      {editable && (
                        <button className="btn btn-sm btn-primary" style={{ flexShrink: 0 }} onClick={() => openAgrupar(s)}>
                          <i className="ti ti-plus"></i> Agrupar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* COLUMNA DERECHA — grupos */}
            <div className="card">
              <div className="card-header"><div className="card-title"><i className="ti ti-users-group"></i> Clases programadas ({grupos.length})</div></div>
              {grupos.length === 0 ? (
                <div className="empty-state"><i className="ti ti-calendar-plus"></i>Todavía no armaste clases para esta fecha.</div>
              ) : (
                <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {grupos.map(g => {
                    const roster = rosterDe(g.id)
                    const vacio = roster.length === 0
                    const realizada = g.estado === 'realizada'
                    const noRealizada = g.estado === 'no_realizada'
                    const marcada = realizada || noRealizada
                    const asistieron = roster.filter(r => asistencias[r.id]?.asistio).length
                    const dur = duracionHorasDe(g)
                    const desmarcable = puedeDesmarcar(g)
                    const borderColor = realizada ? 'rgba(29,158,117,0.4)' : (noRealizada || vacio) ? 'rgba(240,149,149,0.4)' : 'var(--border)'
                    return (
                      <div key={g.id} style={{ border: `0.5px solid ${borderColor}`, borderRadius: 8, padding: '0.8rem 0.9rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 14, color: 'var(--gold-light)', fontWeight: 600 }}><i className="ti ti-clock" style={{ fontSize: 13 }}></i> {hhmm(g.hora_inicio)}–{hhmm(g.hora_fin)}</span>
                            <TipoBadge tipo={g.tipo} />
                            {realizada && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(29,158,117,0.15)', color: '#5dcaa5' }}>Realizada</span>}
                            {noRealizada && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(163,45,45,0.15)', color: '#f09595' }}>No realizada</span>}
                          </div>
                          {editable && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-sm" disabled={marcada} onClick={() => !marcada && openEditGrupo(g)}
                                title={marcada ? 'Esta clase ya fue marcada como realizada. Desmárcala primero para editar.' : 'Editar grupo'}><i className="ti ti-edit"></i></button>
                              <button className="btn btn-sm btn-danger" disabled={marcada} onClick={() => !marcada && handleEliminarGrupo(g)}
                                title={marcada ? 'Esta clase ya fue marcada como realizada. Desmárcala primero para editar.' : 'Eliminar grupo'}><i className="ti ti-trash"></i></button>
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginBottom: 6 }}>
                          {marcada
                            ? <>{asistieron} de {roster.length} asistieron · Profesor: {g.clases_profesores?.nombre || '— sin asignar'}{realizada && <> · <strong style={{ color: 'var(--gold-light)' }}>{labelHoras(dur)}</strong></>}</>
                            : <>{roster.length} estudiante{roster.length === 1 ? '' : 's'} · Profesor: {g.clases_profesores?.nombre || '— sin asignar'}</>}
                        </div>

                        {vacio && !marcada ? (
                          <div style={{ fontSize: 12, color: '#f09595', fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <i className="ti ti-alert-triangle"></i> Grupo sin participantes
                            {editable && <button className="btn btn-sm" style={{ color: '#f09595', borderColor: 'rgba(240,149,149,0.4)', fontSize: 11 }} onClick={() => handleEliminarGrupo(g)}>Eliminar</button>}
                          </div>
                        ) : marcada ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {roster.map(r => {
                              const fue = asistencias[r.id]?.asistio
                              return (
                                <span key={r.id} className="chip" style={{ fontSize: 11, opacity: fue ? 1 : 0.55, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  {r.participanteNombre}
                                  <i className={`ti ${fue ? 'ti-check' : 'ti-x'}`} style={{ fontSize: 11, color: fue ? '#5dcaa5' : '#f09595' }}></i>
                                </span>
                              )
                            })}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {roster.map(r => (
                              <span key={r.id} className="chip" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                {r.participanteNombre}
                                {editable && (
                                  <button onClick={() => openAgrupar(r)} title="Mover a otro grupo"
                                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}>
                                    <i className="ti ti-arrows-exchange" style={{ fontSize: 12 }}></i>
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}

                        {editable && (
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid rgba(201,168,76,0.08)' }}>
                            {!marcada ? (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <button className="btn btn-sm btn-primary" style={{ fontSize: 11 }} disabled={vacio} onClick={() => openMarcar(g)}
                                  title={vacio ? 'No hay participantes para marcar' : 'Marcar asistencia y cerrar la clase'}>
                                  <i className="ti ti-checkbox"></i> Marcar realizada
                                </button>
                                {roster.length >= 2 && (
                                  <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => openDividir(g)}
                                    title="Mover algunos alumnos a un grupo nuevo">
                                    <i className="ti ti-arrows-split-2"></i> Dividir
                                  </button>
                                )}
                              </div>
                            ) : (
                              <button className="btn btn-sm" style={{ fontSize: 11, color: desmarcable ? '#fac775' : 'var(--text-dim)', borderColor: desmarcable ? 'rgba(239,159,39,0.4)' : 'var(--border)' }}
                                disabled={!desmarcable} onClick={() => desmarcable && handleDesmarcar(g)}
                                title={desmarcable ? 'Revertir a agendada' : 'Solo el administrador puede revertir clases de días anteriores.'}>
                                <i className="ti ti-arrow-back-up"></i> Desmarcar realizada
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginTop: 16 }}>
            {[
              { label: 'Estudiantes hoy', value: estudiantesHoy, color: '#5dcaa5' },
              { label: 'Horas-profesor', value: fmtHoras(horasProfesor), color: 'var(--gold-light)' },
              { label: 'Realizadas hoy', value: realizadasHoy, color: '#85b7eb' },
              { label: 'Pendientes', value: pendientes.length, color: '#fac775' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Modal Agrupar */}
      {agruparSol && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setAgruparSol(null)}>
          <div className="modal" style={{ width: 480, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">{esMover ? 'Mover' : 'Agrupar'}: {agruparSol.participanteNombre} <TipoBadge tipo={agruparSol.tipo} /></div>
              <button className="btn btn-sm" onClick={() => setAgruparSol(null)}><i className="ti ti-x"></i></button>
            </div>
            <div style={{ padding: '0.5rem 1rem 1rem' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button onClick={() => setAgruparModo('existente')} disabled={gruposDestino.length === 0}
                  style={{ flex: 1, padding: '8px', borderRadius: 8, cursor: gruposDestino.length ? 'pointer' : 'not-allowed', fontFamily: 'sans-serif', fontSize: 12,
                    border: `1px solid ${agruparModo === 'existente' ? 'var(--gold)' : 'var(--border)'}`, background: agruparModo === 'existente' ? 'rgba(201,168,76,0.12)' : 'transparent',
                    color: gruposDestino.length === 0 ? 'var(--text-dim)' : (agruparModo === 'existente' ? 'var(--gold-light)' : 'var(--text-muted)') }}>
                  Grupo existente ({gruposDestino.length})
                </button>
                <button onClick={() => setAgruparModo('nuevo')}
                  style={{ flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer', fontFamily: 'sans-serif', fontSize: 12,
                    border: `1px solid ${agruparModo === 'nuevo' ? 'var(--gold)' : 'var(--border)'}`, background: agruparModo === 'nuevo' ? 'rgba(201,168,76,0.12)' : 'transparent',
                    color: agruparModo === 'nuevo' ? 'var(--gold-light)' : 'var(--text-muted)' }}>
                  Crear nuevo grupo
                </button>
              </div>

              {agruparModo === 'existente' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {gruposDestino.map(g => (
                    <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: `0.5px solid ${agruparGrupoId === g.id ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer' }}>
                      <input type="radio" name="grupo" checked={agruparGrupoId === g.id} onChange={() => setAgruparGrupoId(g.id)} />
                      <span style={{ fontSize: 13, color: '#c8d0dc' }}>{hhmm(g.hora_inicio)}–{hhmm(g.hora_fin)}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>· {rosterDe(g.id).length} est. · {g.clases_profesores?.nombre || 'sin profesor'}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="form-grid">
                  <div className="form-group"><label>Hora inicio</label><input type="time" value={nuevoGrupo.hora_inicio} onChange={e => setNuevoGrupo(f => ({ ...f, hora_inicio: e.target.value }))} /></div>
                  <div className="form-group"><label>Hora fin</label><input type="time" value={nuevoGrupo.hora_fin} onChange={e => setNuevoGrupo(f => ({ ...f, hora_fin: e.target.value }))} /></div>
                  <div className="form-group full"><label>Profesor</label>
                    <select value={nuevoGrupo.profesor_id} onChange={e => setNuevoGrupo(f => ({ ...f, profesor_id: e.target.value }))}>
                      <option value="">— sin asignar —</option>
                      {profesores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </div>
                  <div className="form-group full"><label>Comentario (opcional)</label><input value={nuevoGrupo.comentario} onChange={e => setNuevoGrupo(f => ({ ...f, comentario: e.target.value }))} /></div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setAgruparSol(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleConfirmarAgrupar} disabled={guardandoAgrupar || (agruparModo === 'existente' && !agruparGrupoId)}>
                {guardandoAgrupar ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {esMover ? 'Mover' : 'Agrupar'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar grupo */}
      {editGrupo && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditGrupo(null)}>
          <div className="modal" style={{ width: 440, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">Editar grupo</div>
              <button className="btn btn-sm" onClick={() => setEditGrupo(null)}><i className="ti ti-x"></i></button>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Hora inicio</label><input type="time" value={formEdit.hora_inicio} onChange={e => setFormEdit(f => ({ ...f, hora_inicio: e.target.value }))} /></div>
              <div className="form-group"><label>Hora fin</label><input type="time" value={formEdit.hora_fin} onChange={e => setFormEdit(f => ({ ...f, hora_fin: e.target.value }))} /></div>
              <div className="form-group full"><label>Profesor</label>
                <select value={formEdit.profesor_id} onChange={e => setFormEdit(f => ({ ...f, profesor_id: e.target.value }))}>
                  <option value="">— sin asignar —</option>
                  {profesores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div className="form-group full"><label>Comentario (opcional)</label><input value={formEdit.comentario} onChange={e => setFormEdit(f => ({ ...f, comentario: e.target.value }))} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditGrupo(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleGuardarEdit} disabled={guardandoEdit}>
                {guardandoEdit ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Guardar cambios</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Dividir grupo */}
      {dividirGrupo && (() => {
        const roster = rosterDe(dividirGrupo.id)
        const seleccionados = roster.filter(r => dividirSel[r.id]).length
        const quedan = roster.length - seleccionados
        const dur = duracionHorasDe({ hora_inicio: dividirForm.hora_inicio, hora_fin: dividirForm.hora_fin })
        return (
          <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setDividirGrupo(null)}>
            <div className="modal" style={{ width: 520, maxWidth: '95vw' }}>
              <div className="modal-header">
                <div className="modal-title">Dividir grupo <TipoBadge tipo={dividirGrupo.tipo} /></div>
                <button className="btn btn-sm" onClick={() => setDividirGrupo(null)}><i className="ti ti-x"></i></button>
              </div>
              <div style={{ padding: '0.5rem 1rem 1rem' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginBottom: 12 }}>
                  Grupo original: {fmtDiaFecha(dividirGrupo.fecha)} · {hhmm(dividirGrupo.hora_inicio)}–{hhmm(dividirGrupo.hora_fin)}. Marca los alumnos que pasan al nuevo grupo.
                </div>

                <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif' }}>Alumnos al nuevo grupo</label>
                <div style={{ marginTop: 6, marginBottom: 14, border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  {roster.map(r => {
                    const va = !!dividirSel[r.id]
                    return (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '0.5px solid rgba(201,168,76,0.08)', opacity: va ? 1 : 0.6 }}>
                        <input type="checkbox" checked={va} onChange={() => toggleDividirSel(r.id)} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: '#c8d0dc' }}>{r.participanteNombre}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
                            {r.participante_tipo === 'beneficiario' ? `Hijo/a de ${r.socioNombre}` : 'Socio titular'} · Nivel: {nivelNombre(r.nivel_id)}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: va ? 'rgba(201,168,76,0.15)' : 'rgba(120,130,145,0.12)', color: va ? 'var(--gold-light)' : 'var(--text-dim)' }}>
                          {va ? 'Nuevo grupo' : 'Se queda'}
                        </span>
                      </div>
                    )
                  })}
                </div>

                <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif' }}>Datos del nuevo grupo</label>
                <div className="form-grid" style={{ marginTop: 6 }}>
                  <div className="form-group"><label>Hora inicio</label><input type="time" value={dividirForm.hora_inicio} onChange={e => setDividirForm(f => ({ ...f, hora_inicio: e.target.value }))} /></div>
                  <div className="form-group"><label>Hora fin</label><input type="time" value={dividirForm.hora_fin} onChange={e => setDividirForm(f => ({ ...f, hora_fin: e.target.value }))} /></div>
                  <div className="form-group full"><label>Profesor</label>
                    <select value={dividirForm.profesor_id} onChange={e => setDividirForm(f => ({ ...f, profesor_id: e.target.value }))}>
                      <option value="">— sin asignar —</option>
                      {profesores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </div>
                  <div className="form-group full"><label>Comentario (opcional)</label><input value={dividirForm.comentario} onChange={e => setDividirForm(f => ({ ...f, comentario: e.target.value }))} /></div>
                </div>

                <div style={{ marginTop: 12, padding: '0.7rem 0.9rem', borderRadius: 8, fontSize: 12, fontFamily: 'sans-serif', background: 'rgba(239,159,39,0.1)', border: '0.5px solid rgba(239,159,39,0.3)', color: '#fac775' }}>
                  <i className="ti ti-info-circle"></i> Se crea una 2ª clase de <strong>{labelHoras(dur)}</strong>. Al marcarse realizada sumará horas-profesor al corte abierto (correcto: son dos clases). No afecta cortes cerrados.
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => setDividirGrupo(null)}>Cancelar</button>
                <button className="btn btn-primary" onClick={handleConfirmarDividir} disabled={guardandoDividir || seleccionados === 0 || quedan === 0}>
                  {guardandoDividir ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-arrows-split-2"></i> Dividir ({seleccionados})</>}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal Confirmar asistencia */}
      {marcarGrupo && (() => {
        const roster = rosterDe(marcarGrupo.id)
        const total = roster.length
        const asistieron = roster.filter(r => asistenciaForm[r.id]?.asistio).length
        const algunoAsistio = asistieron > 0
        const dur = duracionHorasDe(marcarGrupo)
        return (
          <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setMarcarGrupo(null)}>
            <div className="modal" style={{ width: 520, maxWidth: '95vw' }}>
              <div className="modal-header">
                <div className="modal-title">Confirmar asistencia</div>
                <button className="btn btn-sm" onClick={() => setMarcarGrupo(null)}><i className="ti ti-x"></i></button>
              </div>
              <div style={{ padding: '0.5rem 1rem 1rem' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  {fmtDiaFecha(marcarGrupo.fecha)} · {hhmm(marcarGrupo.hora_inicio)}–{hhmm(marcarGrupo.hora_fin)} <TipoBadge tipo={marcarGrupo.tipo} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                  <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.7rem 0.9rem' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Profesor</div>
                    <div style={{ fontSize: 14, color: '#c8d0dc' }}>{marcarGrupo.clases_profesores?.nombre || '— sin asignar'}</div>
                  </div>
                  <div style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.7rem 0.9rem' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 4 }}>Duración</div>
                    <div style={{ fontSize: 14, color: 'var(--gold-light)' }}>{labelHoras(dur)}</div>
                  </div>
                </div>

                <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif' }}>Asistencia</label>
                <div style={{ marginTop: 6, border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  {roster.map(r => {
                    const fue = !!asistenciaForm[r.id]?.asistio
                    return (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '0.5px solid rgba(201,168,76,0.08)', opacity: fue ? 1 : 0.6 }}>
                        <input type="checkbox" checked={fue} onChange={() => toggleAsistio(r.id)} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: '#c8d0dc' }}>{r.participanteNombre}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
                            {r.participante_tipo === 'beneficiario' ? `Hijo/a de ${r.socioNombre}` : 'Socio titular'}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: fue ? 'rgba(29,158,117,0.15)' : 'rgba(163,45,45,0.15)', color: fue ? '#5dcaa5' : '#f09595' }}>
                          {fue ? 'Asistió' : 'Faltó'}
                        </span>
                      </div>
                    )
                  })}
                </div>

                <div style={{ marginTop: 14, padding: '0.7rem 0.9rem', borderRadius: 8, fontSize: 12, fontFamily: 'sans-serif',
                  background: algunoAsistio ? 'rgba(29,158,117,0.1)' : 'rgba(239,159,39,0.1)',
                  border: `0.5px solid ${algunoAsistio ? 'rgba(29,158,117,0.3)' : 'rgba(239,159,39,0.3)'}`,
                  color: algunoAsistio ? '#5dcaa5' : '#fac775' }}>
                  {algunoAsistio
                    ? <><i className="ti ti-check"></i> {asistieron} de {total} asistieron · La clase se contará como <strong>{labelHoras(dur)}</strong>.</>
                    : <><i className="ti ti-alert-triangle"></i> Nadie asistió. La clase quedará como <strong>"No realizada"</strong> y no se contará como hora-profesor.</>}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => setMarcarGrupo(null)}>Cancelar</button>
                <button className="btn" onClick={handleConfirmarMarcar} disabled={guardandoMarcar}
                  style={{ background: algunoAsistio ? 'var(--green, #1d9e75)' : 'transparent', color: algunoAsistio ? '#fff' : '#fac775', borderColor: algunoAsistio ? 'transparent' : 'rgba(239,159,39,0.5)', fontWeight: 600 }}>
                  {guardandoMarcar ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {algunoAsistio ? 'Confirmar realizada' : 'Confirmar no realizada'}</>}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
