import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import { dispatchAviso } from '../lib/comunicaciones'

// timestamptz → "dd/mm/yyyy HH:MM" sin new Date() (regla del proyecto).
const fmtFechaHora = (ts) => {
  if (!ts) return ''
  const [fecha, resto = ''] = ts.split('T')
  return `${fecha.split('-').reverse().join('/')} ${resto.slice(0, 5)}`
}

// Valores de ejemplo para el botón "Enviar prueba a mí".
const EJEMPLOS = {
  nombre: 'Juan Pérez',
  fecha: '15/07/2026',
  notas: 'Cupos limitados, inscríbete pronto.',
  socio: 'Juan Pérez',
  participantes: 'Juan Pérez, Sofía Pérez',
  tipo: 'esquí',
  hora_inicio: '10:00',
  hora_fin: '12:00',
  profesor: ' con el profesor Andrés',
}
// Arma variables de ejemplo a partir del campo `variables` de la plantilla.
const ejemploVars = (variablesStr) => {
  const vars = {}
  for (const m of (variablesStr || '').matchAll(/\{(\w+)\}/g)) {
    vars[m[1]] = EJEMPLOS[m[1]] ?? `[${m[1]}]`
  }
  return vars
}

const OPERADOR_KEY = 'clases_operador_email'
const ESTADOS_KEY = 'avisos_escuela_estados'
const ESTADOS_LIST = [
  { key: 'activo', label: 'Activos' },
  { key: 'pendiente', label: 'Pendientes' },
  { key: 'inactivo', label: 'Inactivos' },
]

export default function Avisos() {
  const { showToast, ToastComponent } = useToast()
  const { user, tieneAcceso, puedeEditar } = useAuth()
  const editable = puedeEditar('avisos')

  const [plantillas, setPlantillas] = useState([])
  const [operadorEmail, setOperadorEmail] = useState('')
  const [operadorDraft, setOperadorDraft] = useState('')
  const [envios, setEnvios] = useState([])
  const [loading, setLoading] = useState(true)

  const [editP, setEditP] = useState(null)              // plantilla en edición
  const [form, setForm] = useState({ asunto: '', cuerpo_html: '' })
  const [guardando, setGuardando] = useState(false)
  const [probando, setProbando] = useState(null)        // clave en prueba

  // Segmentación por estado (config_club.avisos_escuela_estados)
  const [estadosSel, setEstadosSel] = useState({ activo: false, pendiente: false, inactivo: false })
  const [estadosOrig, setEstadosOrig] = useState('')    // valor tal como se cargó (para dirty check)
  const [conteoEstados, setConteoEstados] = useState({})
  const [guardandoEstados, setGuardandoEstados] = useState(false)

  useEffect(() => { if (tieneAcceso('avisos')) load() }, [])

  const load = async () => {
    setLoading(true)
    const [{ data: pls }, { data: cfgs }, { data: evs }, { data: socs }] = await Promise.all([
      supabase.from('comunicaciones_plantillas').select('*').order('clave'),
      supabase.from('config_club').select('clave,valor').in('clave', [OPERADOR_KEY, ESTADOS_KEY]),
      supabase.from('comunicaciones_envios').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('socios').select('estado'),
    ])
    const cfgMap = Object.fromEntries((cfgs || []).map(c => [c.clave, c.valor]))
    setPlantillas(pls || [])
    setOperadorEmail(cfgMap[OPERADOR_KEY] || '')
    setOperadorDraft(cfgMap[OPERADOR_KEY] || '')

    const estadosVal = cfgMap[ESTADOS_KEY] || ''
    const arr = estadosVal.split(',').map(s => s.trim()).filter(Boolean)
    setEstadosSel({ activo: arr.includes('activo'), pendiente: arr.includes('pendiente'), inactivo: arr.includes('inactivo') })
    setEstadosOrig(estadosVal)
    const cnt = {}
    ;(socs || []).forEach(s => { cnt[s.estado] = (cnt[s.estado] || 0) + 1 })
    setConteoEstados(cnt)

    setEnvios(evs || [])
    setLoading(false)
  }

  const toggleEstado = (k) => setEstadosSel(prev => ({ ...prev, [k]: !prev[k] }))
  // Cadena canónica (mismo orden siempre) para guardar y comparar.
  const estadosStr = ESTADOS_LIST.filter(e => estadosSel[e.key]).map(e => e.key).join(',')
  const saveEstados = async () => {
    setGuardandoEstados(true)
    const { error } = await supabase.from('config_club').update({ valor: estadosStr }).eq('clave', ESTADOS_KEY)
    setGuardandoEstados(false)
    if (error) { showToast('Error al guardar: ' + error.message, 'error'); return }
    setEstadosOrig(estadosStr)
    showToast('Destinatarios de la Escuela actualizados')
  }

  const toggleActivo = async (p) => {
    const { error } = await supabase.from('comunicaciones_plantillas').update({ activo: !p.activo }).eq('id', p.id)
    if (error) { showToast('Error al cambiar el estado: ' + error.message, 'error'); return }
    setPlantillas(prev => prev.map(x => x.id === p.id ? { ...x, activo: !x.activo } : x))
  }

  const openEdit = (p) => { setEditP(p); setForm({ asunto: p.asunto, cuerpo_html: p.cuerpo_html }) }
  const saveEdit = async () => {
    if (!form.asunto.trim() || !form.cuerpo_html.trim()) { showToast('Asunto y cuerpo son obligatorios', 'error'); return }
    setGuardando(true)
    const { error } = await supabase.from('comunicaciones_plantillas')
      .update({ asunto: form.asunto, cuerpo_html: form.cuerpo_html }).eq('id', editP.id)
    setGuardando(false)
    if (error) { showToast('Error al guardar: ' + error.message, 'error'); return }
    showToast('Plantilla actualizada')
    setEditP(null)
    load()
  }

  const saveOperador = async () => {
    const val = operadorDraft.trim()
    const { error } = await supabase.from('config_club').update({ valor: val }).eq('clave', OPERADOR_KEY)
    if (error) { showToast('Error al guardar el email: ' + error.message, 'error'); return }
    setOperadorEmail(val)
    showToast('Email del operador actualizado')
  }

  const enviarPrueba = async (p) => {
    if (!user?.email) { showToast('Tu usuario no tiene email registrado', 'error'); return }
    setProbando(p.clave)
    const res = await dispatchAviso(
      p.clave,
      [{ email: user.email, socio_id: user.socio_id || null, variables: ejemploVars(p.variables) }],
      { prueba: true },
    )
    setProbando(null)
    if (res.omitido) showToast('La plantilla está inactiva: actívala para probarla', 'error')
    else if (res.enviados > 0) showToast(`Correo de prueba enviado a ${user.email}`)
    else showToast('No se pudo enviar la prueba (revisa el registro)', 'error')
    load()
  }

  if (!tieneAcceso('avisos')) {
    return (
      <div className="card"><div className="empty-state">
        <i className="ti ti-lock" style={{ color: 'var(--gold-dim)' }}></i>
        No tienes acceso a Avisos por email.
      </div></div>
    )
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {ToastComponent}

      {/* Plantillas */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-mail"></i> Plantillas de aviso</div>
        </div>
        {loading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
        ) : plantillas.length === 0 ? (
          <div className="empty-state"><i className="ti ti-mail-off"></i>No hay plantillas.</div>
        ) : (
          <div style={{ padding: '0.5rem 0' }}>
            {plantillas.map(p => (
              <div key={p.id} style={{ borderBottom: '0.5px solid rgba(201,168,76,0.08)', padding: '0.9rem 1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, color: '#c8d0dc', fontWeight: 600 }}>{p.nombre}</span>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-dim)' }}>{p.clave}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: p.activo ? 'rgba(29,158,117,0.15)' : 'rgba(127,140,158,0.15)', color: p.activo ? '#5dcaa5' : 'var(--text-dim)' }}>
                        {p.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginTop: 3 }}>Asunto: {p.asunto}</div>
                    {p.variables && <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'monospace', marginTop: 3 }}>Variables: {p.variables}</div>}
                  </div>
                  {editable && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => toggleActivo(p)} title={p.activo ? 'Desactivar' : 'Activar'}>
                        <i className={`ti ${p.activo ? 'ti-toggle-right' : 'ti-toggle-left'}`}></i> {p.activo ? 'Activo' : 'Inactivo'}
                      </button>
                      <button className="btn btn-sm" onClick={() => openEdit(p)}><i className="ti ti-edit"></i> Editar</button>
                      <button className="btn btn-sm btn-primary" disabled={probando === p.clave} onClick={() => enviarPrueba(p)}>
                        {probando === p.clave ? <><i className="ti ti-loader"></i> Enviando…</> : <><i className="ti ti-send"></i> Enviar prueba a mí</>}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Email del operador */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-user-cog"></i> Email del operador de clases</div>
        </div>
        <div style={{ padding: '1rem 1.5rem' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginBottom: 8 }}>
            Recibe el aviso cuando un socio inscribe a alguien en clases.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="email" value={operadorDraft} onChange={e => setOperadorDraft(e.target.value)} disabled={!editable}
              placeholder="operador@ejemplo.cl" style={{ flex: 1, minWidth: 220 }} />
            {editable && (
              <button className="btn btn-primary" onClick={saveOperador} disabled={operadorDraft.trim() === operadorEmail.trim()}>
                <i className="ti ti-check"></i> Guardar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Destinatarios de avisos de la Escuela (segmentación por estado) */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-users-group"></i> Destinatarios de avisos de la Escuela</div>
        </div>
        <div style={{ padding: '1rem 1.5rem' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif', marginBottom: 12, lineHeight: 1.5 }}>
            Los avisos de la Escuela de esquí se enviarán solo a socios en los estados marcados
            (y que tengan activada la recepción en su perfil). Queda fijo hasta que lo cambies.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {ESTADOS_LIST.map(e => {
              const on = !!estadosSel[e.key]
              return (
                <button key={e.key} onClick={() => editable && toggleEstado(e.key)} disabled={!editable}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 8,
                    cursor: editable ? 'pointer' : 'default', fontFamily: 'sans-serif', fontSize: 13,
                    border: `1px solid ${on ? 'var(--gold)' : 'var(--border)'}`,
                    background: on ? 'rgba(201,168,76,0.12)' : 'transparent',
                    color: on ? 'var(--gold-light)' : 'var(--text-muted)',
                  }}>
                  <i className={`ti ${on ? 'ti-square-check' : 'ti-square'}`} style={{ fontSize: 16 }}></i>
                  {e.label}
                  {conteoEstados[e.key] != null && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>({conteoEstados[e.key]})</span>}
                </button>
              )
            })}
          </div>
          {editable && (
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={saveEstados} disabled={guardandoEstados || estadosStr === estadosOrig}>
                {guardandoEstados ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Guardar</>}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Registro de envíos */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-history"></i> Registro de envíos</div>
        </div>
        {loading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
        ) : envios.length === 0 ? (
          <div className="empty-state"><i className="ti ti-mail-off"></i>Sin envíos registrados.</div>
        ) : (
          <div style={{ padding: '0.5rem 0' }}>
            {envios.map(e => (
              <div key={e.id} style={{ borderBottom: '0.5px solid rgba(201,168,76,0.08)', padding: '0.7rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#c8d0dc' }}>{e.email_destino || '— sin email —'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                    <span style={{ fontFamily: 'monospace' }}>{e.plantilla_clave}</span> · {fmtFechaHora(e.created_at)}
                    {e.estado === 'error' && e.error_mensaje && <> · <span style={{ color: '#f09595' }}>{e.error_mensaje}</span></>}
                  </div>
                </div>
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: e.estado === 'enviado' ? 'rgba(29,158,117,0.15)' : 'rgba(163,45,45,0.15)', color: e.estado === 'enviado' ? '#5dcaa5' : '#f09595' }}>
                  {e.estado === 'enviado' ? 'Enviado' : 'Error'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal editar plantilla */}
      {editP && (
        <div className="modal-overlay" onClick={ev => ev.target === ev.currentTarget && setEditP(null)}>
          <div className="modal" style={{ width: 620, maxWidth: '95vw' }}>
            <div className="modal-header">
              <div className="modal-title">Editar: {editP.nombre}</div>
              <button className="btn btn-sm" onClick={() => setEditP(null)}><i className="ti ti-x"></i></button>
            </div>
            <div style={{ padding: '0.5rem 1rem 1rem' }}>
              {editP.variables && (
                <div style={{ marginBottom: 12, padding: '0.6rem 0.8rem', borderRadius: 8, background: 'rgba(201,168,76,0.08)', border: '0.5px solid rgba(201,168,76,0.2)', fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>
                  <i className="ti ti-variable"></i> Variables disponibles: <span style={{ fontFamily: 'monospace', color: 'var(--gold-light)' }}>{editP.variables}</span>
                </div>
              )}
              <div className="form-group full" style={{ marginBottom: 12 }}>
                <label>Asunto</label>
                <input value={form.asunto} onChange={e => setForm(f => ({ ...f, asunto: e.target.value }))} />
              </div>
              <div className="form-group full">
                <label>Cuerpo (HTML)</label>
                <textarea rows={9} value={form.cuerpo_html} onChange={e => setForm(f => ({ ...f, cuerpo_html: e.target.value }))}
                  style={{ resize: 'vertical', width: '100%', fontFamily: 'monospace', fontSize: 12.5 }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditP(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={guardando}>
                {guardando ? <><i className="ti ti-loader"></i> Guardando…</> : <><i className="ti ti-check"></i> Guardar cambios</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
