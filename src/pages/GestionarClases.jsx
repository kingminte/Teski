import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import BitacoraFormModal from '../components/BitacoraFormModal'
import { dispatchAviso, quiereAviso } from '../lib/comunicaciones'

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const fmtDiaFecha = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${DIAS[dt.getDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}
const hhmm = (t) => (t || '').slice(0, 5)
// Comparación y formato sobre el ISO crudo: nunca new Date('YYYY-MM-DD').
const esFechaPasada = (iso) => !!iso && iso < hoyISO()
const fmtDDMMYYYY = (iso) => (iso ? iso.split('-').reverse().join('/') : '')
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
const EMPTY_RETRO = { fecha: '', tipo: 'esqui', hora_inicio: '10:00', hora_fin: '12:00', profesor_id: '', comentario: '', notas: '', marcarRealizada: true }

const BadgePorAsignar = () => (
  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(239,159,39,0.15)', color: '#fac775' }}>
    <i className="ti ti-user-question" style={{ fontSize: 11 }}></i> Profesor por asignar
  </span>
)

export default function GestionarClases() {
  const { showToast, ToastComponent } = useToast()
  const { puedeEditar, user } = useAuth()
  const editable = puedeEditar('clases_gestion')
  const puedeFeedback = puedeEditar('clases_bitacora')   // admin/andacor: escribir bitácora
  // Registro retroactivo: solo admin. Asignar profesor a un grupo "por asignar":
  // admin y andacor (andacor completa después lo que el admin dejó pendiente).
  const esAdmin = user?.rol === 'admin'
  const puedeAsignarProfesor = esAdmin || user?.rol === 'andacor'
  const nombreUsuario = user?.nombre || user?.username || 'usuario'

  // Feedback (bitácora): alumno + contexto de la clase para el formulario reutilizable
  const [feedbackCtx, setFeedbackCtx] = useState(null)   // { alumno, fecha, grupoId }
  const openFeedback = (r, g) => setFeedbackCtx({
    alumno: { participante_tipo: r.participante_tipo, participante_id: r.participante_id, socio_id: r.socio_id, nombre: r.participanteNombre },
    fecha: g.fecha,
    grupoId: g.id,
  })

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

  // Registro retroactivo (admin)
  const [showRetro, setShowRetro] = useState(false)
  const [retroForm, setRetroForm] = useState(EMPTY_RETRO)
  const [retroSel, setRetroSel] = useState({})      // 'tipo:id' -> true
  const [retroBusca, setRetroBusca] = useState('')
  const [guardandoRetro, setGuardandoRetro] = useState(false)
  const [sociosTodos, setSociosTodos] = useState([])
  const [beneficiariosTodos, setBeneficiariosTodos] = useState([])

  // Asignar profesor a un grupo sin profesor
  const [asignarGrupo, setAsignarGrupo] = useState(null)
  const [asignarProfId, setAsignarProfId] = useState('')
  const [guardandoAsignar, setGuardandoAsignar] = useState(false)

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

  // Aviso de horario (best-effort): relee el grupo y su roster FRESCOS de la BD
  // (el estado local queda stale tras el update), agrupa por socio_id → UN correo
  // por socio con todos sus participantes, resuelve emails y llama a dispatchAviso.
  // Nunca lanza: un fallo de correo no debe afectar la asignación/reprogramación.
  // soloSocioId: si viene, avisa SOLO a ese socio (agrupar/mover → solo el afectado);
  // si es null, avisa a todo el roster (reprogramar → el cambio de hora afecta a todos).
  const enviarAvisoHorario = async (grupoId, soloSocioId = null) => {
    try {
      const { data: g } = await supabase.from('clases_grupos')
        .select('*, clases_profesores(nombre)').eq('id', grupoId).maybeSingle()
      if (!g) return
      const { data: roster } = await supabase.from('clases_solicitudes')
        .select('socio_id, participante_tipo, participante_id')
        .eq('grupo_id', grupoId).neq('estado', 'cancelada')
      if (!roster || roster.length === 0) return

      // Nombres de participantes (socio → socios; beneficiario → beneficiarios)
      // y datos+email de cada socio dueño de familia.
      const socioPartIds = roster.filter(r => r.participante_tipo === 'socio').map(r => r.participante_id)
      const beneIds = roster.filter(r => r.participante_tipo === 'beneficiario').map(r => r.participante_id)
      const socioIds = [...new Set(roster.map(r => r.socio_id))]
      const nombreMap = {}, socioById = {}
      const { data: socs } = await supabase.from('socios').select('id,nombre,apellido,email,preferencias_avisos')
        .in('id', [...new Set([...socioIds, ...socioPartIds])])
      ;(socs || []).forEach(s => { socioById[s.id] = s; nombreMap[s.id] = `${s.nombre} ${s.apellido}` })
      if (beneIds.length) {
        const { data: bs } = await supabase.from('beneficiarios').select('id,nombre,apellido').in('id', beneIds)
        ;(bs || []).forEach(b => { nombreMap[b.id] = `${b.nombre} ${b.apellido}` })
      }

      // Agrupar por socio_id → 1 destinatario por socio con sus participantes juntos.
      const porSocio = {}
      for (const r of roster) {
        (porSocio[r.socio_id] ||= []).push(nombreMap[r.participante_id] || 'Participante')
      }
      const profesorTxt = g.clases_profesores?.nombre ? ` con el profesor ${g.clases_profesores.nombre}` : ''
      const destinatarios = Object.entries(porSocio)
        .filter(([socioId]) => !soloSocioId || socioId === soloSocioId)
        // Consentimiento granular: solo si quiere avisos de horario (general && horario).
        .filter(([socioId]) => quiereAviso(socioById[socioId]?.preferencias_avisos, 'horario'))
        .map(([socioId, nombres]) => {
        const soc = socioById[socioId]
        return {
          email: soc?.email || '',
          socio_id: socioId,
          variables: {
            nombre: soc ? `${soc.nombre} ${soc.apellido}` : '',
            participantes: nombres.join(', '),
            fecha: (g.fecha || '').split('-').reverse().join('/'),
            hora_inicio: hhmm(g.hora_inicio),
            hora_fin: hhmm(g.hora_fin),
            profesor: profesorTxt,
            tipo: g.tipo === 'snowboard' ? 'snowboard' : 'esquí',
          },
        }
      })
      await dispatchAviso('clases_horario', destinatarios, { grupo_id: grupoId, fecha: g.fecha })
    } catch { /* aviso secundario: nunca romper la operación */ }
  }

  const handleConfirmarAgrupar = async () => {
    const sol = agruparSol
    const moviendo = !!sol.grupo_id
    setGuardandoAgrupar(true)
    try {
      let grupoId = agruparGrupoId
      if (agruparModo === 'nuevo') {
        if (esFechaPasada(sol.fecha) && !esAdmin) { showToast('Solo un administrador puede crear clases en fechas pasadas.', 'error'); setGuardandoAgrupar(false); return }
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
      enviarAvisoHorario(grupoId, sol.socio_id)   // solo el socio recién agregado/movido (best-effort)
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
    else {
      const gid = editGrupo.id
      showToast('Grupo actualizado'); setEditGrupo(null); loadFecha(fechaSel)
      enviarAvisoHorario(gid)   // reprogramación: reavisar a los socios del grupo (best-effort)
    }
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
    if (esFechaPasada(dividirGrupo?.fecha) && !esAdmin) { showToast('Solo un administrador puede crear clases en fechas pasadas.', 'error'); return }
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

  // ----- Registro retroactivo (solo admin) -----
  // Clases que se realizaron pero nunca se registraron: generan diferencias con
  // el cobro de Andacor. Crea grupo + participantes y (opcional) la marca
  // realizada en una sola pasada, dejando traza en el comentario.
  const openRetro = async () => {
    setRetroForm({
      ...EMPTY_RETRO,
      fecha: esFechaPasada(fechaSel) ? fechaSel : hoyISO(),
      comentario: `Registro retroactivo ${fmtDDMMYYYY(hoyISO())} por ${nombreUsuario}`,
    })
    setRetroSel({})
    setRetroBusca('')
    setShowRetro(true)
    if (sociosTodos.length === 0) {
      const [{ data: socs }, { data: bens }] = await Promise.all([
        supabase.from('socios').select('id,nombre,apellido,numero_socio').order('numero_socio'),
        supabase.from('beneficiarios').select('id,socio_id,nombre,apellido,estado').order('nombre'),
      ])
      setSociosTodos(socs || [])
      setBeneficiariosTodos(bens || [])
    }
  }

  const retroParticipantes = sociosTodos.flatMap(s => [
    { key: `socio:${s.id}`, tipo: 'socio', id: s.id, socio_id: s.id, nombre: `${s.nombre} ${s.apellido}`, sub: `${s.numero_socio} · titular` },
    ...beneficiariosTodos.filter(b => b.socio_id === s.id && b.estado === 'vigente').map(b => ({
      key: `beneficiario:${b.id}`, tipo: 'beneficiario', id: b.id, socio_id: s.id,
      nombre: `${b.nombre} ${b.apellido}`, sub: `${s.numero_socio} · ${s.nombre} ${s.apellido}`,
    })),
  ])
  const retroFiltrados = retroBusca.trim()
    ? retroParticipantes.filter(p => `${p.nombre} ${p.sub}`.toLowerCase().includes(retroBusca.trim().toLowerCase()))
    : retroParticipantes
  const retroSeleccionados = retroParticipantes.filter(p => retroSel[p.key])
  const retroFechaHabilitada = disponibilidad.some(d => d.fecha === retroForm.fecha)

  const handleGuardarRetro = async () => {
    const f = retroForm
    if (!esAdmin) { showToast('Solo un administrador puede registrar clases retroactivas', 'error'); return }
    if (!f.fecha) { showToast('Indica la fecha de la clase', 'error'); return }
    if (!f.hora_inicio || !f.hora_fin) { showToast('Indica hora de inicio y fin', 'error'); return }
    if (f.hora_fin <= f.hora_inicio) { showToast('La hora de fin debe ser posterior a la de inicio', 'error'); return }
    if (retroSeleccionados.length === 0) { showToast('Selecciona al menos un participante', 'error'); return }
    if (!retroFechaHabilitada && !f.notas.trim()) { showToast('Para habilitar esta fecha necesitas escribir una nota que lo justifique', 'error'); return }

    setGuardandoRetro(true)
    try {
      // 1. Habilitar la fecha si no estaba. Sin aviso por correo: es una fecha pasada.
      if (!retroFechaHabilitada) {
        const { error } = await supabase.from('clases_disponibilidad')
          .insert({ fecha: f.fecha, notas: f.notas.trim(), created_by: user?.id || null })
        if (error && error.code !== '23505') throw new Error('No se pudo habilitar la fecha: ' + error.message)
      }

      // 2. Un participante no puede quedar dos veces en el mismo día y disciplina.
      const { data: dups } = await supabase.from('clases_solicitudes')
        .select('participante_id').eq('fecha', f.fecha).eq('tipo', f.tipo)
        .in('participante_id', retroSeleccionados.map(p => p.id))
        .in('estado', ['pendiente', 'agendada', 'realizada'])
      if (dups?.length) {
        const nom = retroSeleccionados.find(p => p.id === dups[0].participante_id)?.nombre || 'Un participante'
        throw new Error(`${nom} ya tiene una clase de ${f.tipo === 'snowboard' ? 'snowboard' : 'esquí'} registrada el ${fmtDDMMYYYY(f.fecha)}`)
      }

      // 3. Solape de profesor en esa fecha (los grupos del estado local son de otra fecha).
      if (f.profesor_id) {
        const { data: otros } = await supabase.from('clases_grupos')
          .select('*, clases_profesores(nombre)').eq('fecha', f.fecha).eq('profesor_id', f.profesor_id)
          .in('estado', ['agendada', 'realizada', 'no_realizada'])
        const toMin = (t) => { const [h, m] = (t || '').split(':'); return (+h) * 60 + (+m || 0) }
        const ch = (otros || []).find(g => toMin(g.hora_inicio) < toMin(f.hora_fin) && toMin(f.hora_inicio) < toMin(g.hora_fin))
        if (ch) throw new Error(msgConflicto(ch))
      }

      // 4. Grupo
      const { data: grupo, error: eG } = await supabase.from('clases_grupos').insert({
        fecha: f.fecha, hora_inicio: f.hora_inicio, hora_fin: f.hora_fin, tipo: f.tipo,
        profesor_id: f.profesor_id || null, comentario: f.comentario || null, estado: 'agendada',
      }).select().single()
      if (eG) throw new Error('No se pudo crear la clase: ' + eG.message)

      // 5. Participantes, ya agendados al grupo. Si falla, se borra el grupo.
      const filas = retroSeleccionados.map(p => ({
        socio_id: p.socio_id, participante_tipo: p.tipo, participante_id: p.id,
        fecha: f.fecha, tipo: f.tipo, grupo_id: grupo.id, estado: 'agendada',
      }))
      const { data: solsCreadas, error: eS } = await supabase.from('clases_solicitudes').insert(filas).select('id')
      if (eS) {
        await supabase.from('clases_grupos').delete().eq('id', grupo.id)
        throw new Error('No se pudo inscribir a los participantes; la clase fue revertida: ' + eS.message)
      }

      // 6. Marcar realizada. Si falla, el grupo queda agendada y se puede marcar a mano.
      if (f.marcarRealizada) {
        const { error: eM } = await supabase.rpc('marcar_clase_realizada', {
          p_grupo_id: grupo.id,
          p_asistencias: (solsCreadas || []).map(x => ({ solicitud_id: x.id, asistio: true, comentario: null })),
          p_usuario_id: user?.id || null,
        })
        if (eM) showToast('Clase registrada, pero no se pudo marcar como realizada: ' + eM.message, 'error')
        else showToast('Clase retroactiva registrada y marcada como realizada')
      } else {
        showToast('Clase retroactiva registrada')
      }

      setShowRetro(false)
      const { data: disp } = await supabase.from('clases_disponibilidad').select('*').order('fecha')
      setDisponibilidad(disp || [])
      if (fechaSel === f.fecha) loadFecha(f.fecha)
      else setFechaSel(f.fecha)
    } catch (e) {
      showToast(e.message, 'error')
    }
    setGuardandoRetro(false)
  }

  // ----- Asignar profesor a un grupo "por asignar" (admin y andacor) -----
  const openAsignar = (g) => { setAsignarGrupo(g); setAsignarProfId('') }
  const handleAsignarProfesor = async () => {
    const g = asignarGrupo
    if (!asignarProfId) { showToast('Elige un profesor', 'error'); return }
    const conflicto = detectarConflictoProfesor({ profesorId: asignarProfId, horaIni: hhmm(g.hora_inicio), horaFin: hhmm(g.hora_fin), fecha: g.fecha, excludeId: g.id })
    if (conflicto) { showToast(msgConflicto(conflicto), 'error'); return }
    setGuardandoAsignar(true)
    // Traza de auditoría: se agrega al comentario, nunca lo reemplaza.
    const traza = `Profesor asignado por ${nombreUsuario} el ${fmtDDMMYYYY(hoyISO())}`
    const { error } = await supabase.from('clases_grupos').update({
      profesor_id: asignarProfId,
      comentario: g.comentario ? `${g.comentario}\n${traza}` : traza,
    }).eq('id', g.id)
    setGuardandoAsignar(false)
    if (error) { showToast('Error al asignar profesor: ' + error.message, 'error'); return }
    showToast('Profesor asignado')
    setAsignarGrupo(null)
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
            {esAdmin && (
              <button className="btn btn-sm" onClick={openRetro} title="Registrar una clase que ya se realizó y no quedó registrada">
                <i className="ti ti-calendar-plus"></i> Registrar clase retroactiva
              </button>
            )}
          </div>
        </div>
      </div>

      {!editable && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginBottom: 8 }}>
          <i className="ti ti-eye"></i> Modo solo lectura.
        </div>
      )}

      {editable && esFechaPasada(fechaSel) && (
        <div style={{ padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: 12, fontFamily: 'sans-serif', marginBottom: 8, background: 'rgba(239,159,39,0.1)', border: '0.5px solid rgba(239,159,39,0.3)', color: '#fac775' }}>
          <i className="ti ti-history"></i> Fecha pasada.{' '}
          {esAdmin
            ? 'Puedes registrar clases y marcar asistencia de forma retroactiva; queda traza en el comentario del grupo.'
            : 'Solo un administrador puede crear clases nuevas en fechas pasadas.'}
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
                            {!g.profesor_id && <BadgePorAsignar />}
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
                                  {puedeFeedback && (
                                    <button onClick={() => openFeedback(r, g)} title="Escribir feedback"
                                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--gold-light)', display: 'inline-flex', alignItems: 'center' }}>
                                      <i className="ti ti-message-plus" style={{ fontSize: 12 }}></i>
                                    </button>
                                  )}
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
                                {puedeFeedback && (
                                  <button onClick={() => openFeedback(r, g)} title="Escribir feedback"
                                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--gold-light)', display: 'inline-flex', alignItems: 'center' }}>
                                    <i className="ti ti-message-plus" style={{ fontSize: 12 }}></i>
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}

                        {!g.profesor_id && puedeAsignarProfesor && (
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid rgba(239,159,39,0.2)' }}>
                            <button className="btn btn-sm" style={{ fontSize: 11, color: '#fac775', borderColor: 'rgba(239,159,39,0.4)' }} onClick={() => openAsignar(g)}>
                              <i className="ti ti-user-plus"></i> Asignar profesor
                            </button>
                            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginLeft: 8 }}>
                              No suma horas al corte hasta asignarlo.
                            </span>
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
                      <option value="">Por asignar</option>
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
                  <option value="">Por asignar</option>
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
                      <option value="">Por asignar</option>
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

      {/* Modal Feedback (bitácora) — formulario reutilizable */}
      {feedbackCtx && (
        <BitacoraFormModal
          alumno={feedbackCtx.alumno} fecha={feedbackCtx.fecha} grupoId={feedbackCtx.grupoId}
          showToast={showToast}
          onClose={() => setFeedbackCtx(null)}
        />
      )}

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

      {/* Modal Asignar profesor */}
      {asignarGrupo && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setAsignarGrupo(null)}>
          <div className="modal" style={{ width: 460 }}>
            <div className="modal-header">
              <div className="modal-title">Asignar profesor</div>
              <button className="btn btn-sm" onClick={() => setAsignarGrupo(null)}><i className="ti ti-x"></i></button>
            </div>
            <div style={{ padding: '0 1.25rem 0.5rem', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
              {fmtDiaFecha(asignarGrupo.fecha)} · {hhmm(asignarGrupo.hora_inicio)}–{hhmm(asignarGrupo.hora_fin)} · {asignarGrupo.tipo === 'snowboard' ? 'Snowboard' : 'Esquí'}
              <div style={{ marginTop: 4 }}>Al asignarlo, la clase pasa a sumar <strong style={{ color: 'var(--gold-light)' }}>{labelHoras(duracionHorasDe(asignarGrupo))}</strong> al corte.</div>
            </div>
            <div className="form-grid">
              <div className="form-group full"><label>Profesor *</label>
                <select value={asignarProfId} onChange={e => setAsignarProfId(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {profesores.map(pr => <option key={pr.id} value={pr.id}>{pr.nombre}</option>)}
                </select>
              </div>
            </div>
            <div style={{ padding: '0 1.25rem 0.5rem', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
              Se registrará en el comentario: "Profesor asignado por {nombreUsuario} el {fmtDDMMYYYY(hoyISO())}".
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setAsignarGrupo(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleAsignarProfesor} disabled={guardandoAsignar || !asignarProfId}>
                {guardandoAsignar ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-user-plus"></i> Asignar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Registrar clase retroactiva (admin) */}
      {showRetro && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowRetro(false)}>
          <div className="modal" style={{ width: 660, maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <div className="modal-title">Registrar clase retroactiva</div>
              <button className="btn btn-sm" onClick={() => setShowRetro(false)}><i className="ti ti-x"></i></button>
            </div>
            <div style={{ padding: '0 1.25rem 0.5rem', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
              Para clases que se realizaron y no quedaron registradas. Se inscriben los participantes y, si lo marcas, la clase queda realizada y entra al corte abierto.
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Fecha de la clase *</label>
                <input type="date" value={retroForm.fecha} onChange={e => setRetroForm(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div className="form-group"><label>Disciplina</label>
                <select value={retroForm.tipo} onChange={e => setRetroForm(f => ({ ...f, tipo: e.target.value }))}>
                  <option value="esqui">Esquí</option>
                  <option value="snowboard">Snowboard</option>
                </select>
              </div>
              <div className="form-group"><label>Hora inicio *</label>
                <input type="time" value={retroForm.hora_inicio} onChange={e => setRetroForm(f => ({ ...f, hora_inicio: e.target.value }))} />
              </div>
              <div className="form-group"><label>Hora fin *</label>
                <input type="time" value={retroForm.hora_fin} onChange={e => setRetroForm(f => ({ ...f, hora_fin: e.target.value }))} />
              </div>
              <div className="form-group full"><label>Profesor</label>
                <select value={retroForm.profesor_id} onChange={e => setRetroForm(f => ({ ...f, profesor_id: e.target.value }))}>
                  <option value="">Por asignar</option>
                  {profesores.map(pr => <option key={pr.id} value={pr.id}>{pr.nombre}</option>)}
                </select>
                {!retroForm.profesor_id && (
                  <div style={{ fontSize: 11, color: '#fac775', fontFamily: 'sans-serif', marginTop: 4 }}>
                    <i className="ti ti-info-circle"></i> Sin profesor la clase no suma horas al corte, y el corte no se podrá cerrar hasta asignarlo.
                  </div>
                )}
              </div>
              <div className="form-group full"><label>Comentario</label>
                <input value={retroForm.comentario} onChange={e => setRetroForm(f => ({ ...f, comentario: e.target.value }))} />
              </div>
            </div>

            {retroForm.fecha && !retroFechaHabilitada && (
              <div style={{ margin: '0 1.25rem 0.75rem', padding: '0.7rem 0.9rem', borderRadius: 8, background: 'rgba(239,159,39,0.1)', border: '0.5px solid rgba(239,159,39,0.3)' }}>
                <div style={{ fontSize: 12, color: '#fac775', fontFamily: 'sans-serif', marginBottom: 6 }}>
                  <i className="ti ti-calendar-question"></i> El {fmtDDMMYYYY(retroForm.fecha)} no está en la disponibilidad publicada. Se habilitará al guardar.
                </div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Nota que justifica habilitarla *</label>
                <input value={retroForm.notas} onChange={e => setRetroForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="habilitada retroactivamente — regularización septiembre" />
              </div>
            )}

            <div style={{ padding: '0 1.25rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif' }}>
                  Participantes ({retroSeleccionados.length} seleccionado{retroSeleccionados.length === 1 ? '' : 's'})
                </span>
                <input value={retroBusca} onChange={e => setRetroBusca(e.target.value)} placeholder="Buscar socio o alumno…" style={{ width: 240, fontSize: 12 }} />
              </div>
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '0.5px solid var(--border)', borderRadius: 8 }}>
                {retroParticipantes.length === 0 ? (
                  <div style={{ padding: '0.8rem', fontSize: 12, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>Cargando socios…</div>
                ) : retroFiltrados.length === 0 ? (
                  <div style={{ padding: '0.8rem', fontSize: 12, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>Sin coincidencias.</div>
                ) : retroFiltrados.map(pt => (
                  <label key={pt.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer', borderBottom: '0.5px solid rgba(201,168,76,0.06)' }}>
                    <input type="checkbox" checked={!!retroSel[pt.key]}
                      onChange={e => setRetroSel(prev => { const n = { ...prev }; if (e.target.checked) n[pt.key] = true; else delete n[pt.key]; return n })} />
                    <span style={{ fontSize: 13, color: '#c8d0dc' }}>{pt.nombre}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>{pt.sub}</span>
                  </label>
                ))}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', cursor: 'pointer' }}>
                <input type="checkbox" checked={retroForm.marcarRealizada} onChange={e => setRetroForm(f => ({ ...f, marcarRealizada: e.target.checked }))} />
                Marcar como realizada (todos los seleccionados asistieron) y asignarla al corte abierto
              </label>
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={() => setShowRetro(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleGuardarRetro} disabled={guardandoRetro}>
                {guardandoRetro ? <><i className="ti ti-loader"></i> Registrando…</> : <><i className="ti ti-calendar-plus"></i> Registrar clase</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
