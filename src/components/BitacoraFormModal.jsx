import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/useAuth'

// Formulario reutilizable de feedback de bitácora. UN SOLO componente, abierto
// desde dos entradas:
//  (1) una clase (GestionarClases): alumno + grupo ya determinados
//  (2) la sección Bitácora: tras buscar un alumno
//
// CLAVE: el socio_id lo resuelve el CALLER y lo pasa en `alumno.socio_id`
// (para beneficiario = beneficiarios.socio_id; para socio adulto = su id).
// Aquí solo se persiste — así la vista del padre (UI-2) filtra por el socio_id
// correcto y nunca cruza familias.
//
// Props:
//   alumno   { participante_tipo, participante_id, socio_id, nombre }
//   fecha    ISO por defecto (grupo o hoy)
//   grupoId  opcional (clase de origen) — null desde la sección Bitácora
//   entrada  opcional: si viene, es modo EDICIÓN de esa fila
//   showToast, onClose, onSaved
export default function BitacoraFormModal({ alumno, fecha, grupoId = null, entrada = null, showToast, onClose, onSaved }) {
  const { user } = useAuth()
  const editando = !!entrada
  const [comentario, setComentario] = useState(entrada?.comentario || '')
  const [fechaVal, setFechaVal] = useState(entrada?.fecha || fecha || '')
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    const texto = comentario.trim()
    if (!texto) { showToast('Escribe el feedback', 'error'); return }
    if (!fechaVal) { showToast('Indica la fecha', 'error'); return }
    setGuardando(true)
    let error
    if (editando) {
      ({ error } = await supabase.from('clases_bitacora')
        .update({ comentario: texto, fecha: fechaVal, updated_by: user?.id || null })
        .eq('id', entrada.id))
    } else {
      ({ error } = await supabase.from('clases_bitacora').insert({
        participante_tipo: alumno.participante_tipo,
        participante_id: alumno.participante_id,
        socio_id: alumno.socio_id,          // ← ya resuelto por el caller (clave anti-fuga)
        grupo_id: grupoId,
        profesor_id: null,                  // la UI no pide profesor (basta created_by)
        comentario: texto,
        fecha: fechaVal,
        created_by: user?.id || null,
      }))
    }
    setGuardando(false)
    if (error) { showToast('Error al guardar: ' + error.message, 'error'); return }
    showToast(editando ? 'Feedback actualizado' : 'Feedback guardado')
    onSaved?.()
    onClose?.()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ width: 520, maxWidth: '95vw' }}>
        <div className="modal-header">
          <div className="modal-title">{editando ? 'Editar feedback' : 'Feedback'}: {alumno?.nombre}</div>
          <button className="btn btn-sm" onClick={onClose}><i className="ti ti-x"></i></button>
        </div>
        <div style={{ padding: '0.5rem 1rem 1rem' }}>
          <div className="form-group full" style={{ marginBottom: 12 }}>
            <label>Fecha</label>
            <input type="date" value={fechaVal} onChange={e => setFechaVal(e.target.value)} />
          </div>
          <div className="form-group full">
            <label>Feedback</label>
            <textarea rows={5} value={comentario} onChange={e => setComentario(e.target.value)}
              placeholder="Observaciones de la clase para el alumno…"
              style={{ resize: 'vertical', width: '100%', fontFamily: 'inherit', fontSize: 13 }} />
          </div>
          <div style={{ marginTop: 12, padding: '0.7rem 0.9rem', borderRadius: 8, fontSize: 12, fontFamily: 'sans-serif', background: 'rgba(239,159,39,0.1)', border: '0.5px solid rgba(239,159,39,0.3)', color: '#fac775', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <i className="ti ti-eye" style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}></i>
            Este feedback puede ser visto por la familia. Escríbelo pensando en eso.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
            {guardando ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> {editando ? 'Guardar cambios' : 'Guardar'}</>}
          </button>
        </div>
      </div>
    </div>
  )
}
