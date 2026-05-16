import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'
import { formatearMontoConSimbolo, formatearMonto } from '../lib/montos'

const AVATAR_COLORS = [
  { bg: 'rgba(83,74,183,0.3)', color: '#afa9ec' },
  { bg: 'rgba(29,158,117,0.2)', color: '#5dcaa5' },
  { bg: 'rgba(186,117,23,0.25)', color: '#fac775' },
  { bg: 'rgba(153,60,86,0.25)', color: '#ed93b1' },
  { bg: 'rgba(163,45,45,0.25)', color: '#f09595' },
]

function getAvatarColor(str = '') {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

// CUOTA-{ANIO}-{NUMERO_SOCIO}-{APELLIDO}
function generarReferencia(socio, anio) {
  const apellido = (socio.apellido || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '')
  const numero = socio.numero_socio || 'SN'
  return `CUOTA-${anio}-${numero}-${apellido}`
}

const TEMPLATE_DEFAULT = `Estimado/a {nombre},

Te recordamos que aún tienes pendiente el pago de la cuota social {anio} del Teski Club.

Resumen de tu cuenta:
• Cuota anual {anio}: {monto_cuota}
• Pagado a la fecha: {monto_pagado}
• Saldo pendiente: {monto_pendiente}

{datos_bancarios}

Referencia de pago: {referencia}

Por favor incluye la referencia en el detalle de la transferencia — eso nos permite identificar tu pago automáticamente al conciliar la cartola.

Saludos,
Tesorería Teski Club`

function buildDatosBancarios(config) {
  return [
    `Banco: ${config.banco_nombre || ''}`,
    `Tipo de cuenta: ${config.banco_tipo_cuenta || ''}`,
    `N° de cuenta: ${config.banco_numero_cuenta || ''}`,
    `RUT: ${config.banco_rut || ''}`,
    `Titular: ${config.banco_titular || ''}`,
    `Email: ${config.banco_email || ''}`,
  ].filter(l => !l.endsWith(': ')).join('\n')
}

function renderTemplate(tpl, vars) {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v ?? '')),
    tpl,
  )
}

function textToHTML(text) {
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5;">${
    escape(text).replace(/\n/g, '<br/>')
  }</div>`
}

async function copiarPortapapeles(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function Cobranza() {
  const { showToast, ToastComponent } = useToast()
  const { puedeEditar } = useAuth()
  const editable = puedeEditar('cobranza')

  // Datos
  const [periodos, setPeriodos] = useState([])
  const [selectedPeriodo, setSelectedPeriodo] = useState(null)
  const [socios, setSocios] = useState([])
  const [pagos, setPagos] = useState([])
  const [config, setConfig] = useState({})
  const [envios, setEnvios] = useState([])
  const [loading, setLoading] = useState(true)

  // UI
  const [filtro, setFiltro] = useState('pendientes') // pendientes | sin_pago | parcial | todos
  const [busqueda, setBusqueda] = useState('')
  const [previewSocio, setPreviewSocio] = useState(null)
  const [asunto, setAsunto] = useState('')
  const [cuerpo, setCuerpo] = useState(TEMPLATE_DEFAULT)
  const [enviando, setEnviando] = useState(false)
  const [enviandoMasivo, setEnviandoMasivo] = useState(false)

  // ── Carga inicial ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [{ data: periodosData }, { data: configData }] = await Promise.all([
        supabase.from('periodos_cuota').select('*').order('anio', { ascending: false }),
        supabase.from('config_club').select('*'),
      ])
      setPeriodos(periodosData || [])
      if (periodosData?.length) setSelectedPeriodo(periodosData[0])

      const map = {}
      ;(configData || []).forEach(c => { map[c.clave] = c.valor })
      setConfig(map)
      setAsunto(map.cobranza_asunto || 'Recordatorio de cuota social {anio} — Teski Club')
      if (map.cobranza_cuerpo) setCuerpo(map.cobranza_cuerpo)
      setLoading(false)
    })()
    loadEnvios()
  }, [])

  // Socios filtrados por año del período
  useEffect(() => {
    if (!selectedPeriodo) return
    const anio = selectedPeriodo.anio
    supabase
      .from('socios')
      .select('id,nombre,apellido,numero_socio,email,fecha_ingreso,fecha_inactividad,estado')
      .lte('fecha_ingreso', `${anio}-12-31`)
      .order('numero_socio')
      .then(({ data }) => {
        const filtrados = (data || []).filter(s => {
          if (s.estado === 'inactivo' && s.fecha_inactividad) {
            const anioInactividad = parseInt(s.fecha_inactividad.slice(0, 4))
            if (anioInactividad < anio) return false
          }
          return true
        })
        setSocios(filtrados)
      })
  }, [selectedPeriodo])

  // Pagos del período
  useEffect(() => {
    if (!selectedPeriodo) return
    supabase
      .from('pagos_cuota')
      .select('socio_id,monto')
      .eq('periodo_id', selectedPeriodo.id)
      .then(({ data }) => setPagos(data || []))
  }, [selectedPeriodo])

  const loadEnvios = async () => {
    const { data } = await supabase
      .from('envios_cobranza')
      .select('*, socios(nombre,apellido,numero_socio), periodos_cuota(anio)')
      .order('created_at', { ascending: false })
      .limit(50)
    setEnvios(data || [])
  }

  // ── Cálculos derivados ────────────────────────────────────────
  const montoCuota = selectedPeriodo?.monto || 0
  const anio = selectedPeriodo?.anio || new Date().getFullYear()

  const pagosPorSocio = useMemo(() => {
    const m = {}
    pagos.forEach(p => { m[p.socio_id] = (m[p.socio_id] || 0) + p.monto })
    return m
  }, [pagos])

  const sociosConEstado = useMemo(() => socios.map(s => {
    const pagado = pagosPorSocio[s.id] || 0
    const pendiente = Math.max(0, montoCuota - pagado)
    let estado = 'al_dia'
    if (pagado === 0) estado = 'sin_pago'
    else if (pagado < montoCuota) estado = 'parcial'
    return { ...s, pagado, pendiente, estado, referencia: generarReferencia(s, anio) }
  }), [socios, pagosPorSocio, montoCuota, anio])

  const sociosFiltrados = useMemo(() => {
    const q = busqueda.toLowerCase().trim()
    return sociosConEstado.filter(s => {
      if (filtro === 'pendientes' && s.estado === 'al_dia') return false
      if (filtro === 'sin_pago' && s.estado !== 'sin_pago') return false
      if (filtro === 'parcial' && s.estado !== 'parcial') return false
      if (q && !`${s.nombre} ${s.apellido} ${s.numero_socio} ${s.email || ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [sociosConEstado, filtro, busqueda])

  const resumen = useMemo(() => {
    const sinPago = sociosConEstado.filter(s => s.estado === 'sin_pago').length
    const parcial = sociosConEstado.filter(s => s.estado === 'parcial').length
    const alDia = sociosConEstado.filter(s => s.estado === 'al_dia').length
    const pendienteTotal = sociosConEstado.reduce((t, s) => t + s.pendiente, 0)
    return { sinPago, parcial, alDia, pendienteTotal }
  }, [sociosConEstado])

  // ── Acciones ──────────────────────────────────────────────────
  const datosBancariosTexto = buildDatosBancarios(config)
  const incluirDatosBancarios = config.cobranza_incluir_datos_bancarios !== 'false'

  const buildVars = (socio) => ({
    nombre: `${socio.nombre} ${socio.apellido}`,
    anio,
    monto_cuota: formatearMontoConSimbolo(montoCuota),
    monto_pagado: formatearMontoConSimbolo(socio.pagado),
    monto_pendiente: formatearMontoConSimbolo(socio.pendiente),
    datos_bancarios: incluirDatosBancarios ? datosBancariosTexto : '',
    referencia: socio.referencia,
  })

  const previewVars = previewSocio ? buildVars(previewSocio) : null
  const asuntoRendered = previewVars ? renderTemplate(asunto, previewVars) : asunto
  const cuerpoRendered = previewVars ? renderTemplate(cuerpo, previewVars) : cuerpo

  const registrarEnvio = async ({ socio, tipo, estado, error_mensaje }) => {
    await supabase.from('envios_cobranza').insert({
      socio_id: socio.id,
      periodo_id: selectedPeriodo?.id,
      tipo,
      email_destino: socio.email || null,
      monto_pendiente: socio.pendiente,
      estado,
      error_mensaje,
    })
  }

  const enviarASocio = async (socio, { tipo = 'individual' } = {}) => {
    if (!socio.email) {
      await registrarEnvio({ socio, tipo, estado: 'error', error_mensaje: 'Socio sin email' })
      return { ok: false, error: 'sin_email' }
    }
    const vars = buildVars(socio)
    const asuntoFinal = renderTemplate(asunto, vars)
    const cuerpoFinal = renderTemplate(cuerpo, vars)
    const html = textToHTML(cuerpoFinal)
    const copia = config.cobranza_copia_admin === 'true' ? config.banco_email : undefined

    const { data, error } = await supabase.functions.invoke('enviar-cobranza', {
      body: { destinatario: socio.email, asunto: asuntoFinal, html, copia },
    })

    if (error || data?.error) {
      const msg = error?.message || data?.error || 'Error desconocido'
      await registrarEnvio({ socio, tipo, estado: 'error', error_mensaje: msg })
      return { ok: false, error: msg }
    }

    await registrarEnvio({ socio, tipo, estado: 'enviado' })
    return { ok: true }
  }

  const handleEnviarIndividual = async (socio) => {
    setEnviando(true)
    const res = await enviarASocio(socio, { tipo: 'individual' })
    setEnviando(false)
    if (res.ok) {
      showToast(`Recordatorio enviado a ${socio.email}`)
      loadEnvios()
    } else if (res.error === 'sin_email') {
      showToast(`${socio.nombre} ${socio.apellido} no tiene email registrado`, 'error')
      loadEnvios()
    } else {
      showToast('Error: ' + res.error, 'error')
      loadEnvios()
    }
  }

  const handleEnviarMasivo = async () => {
    const objetivo = sociosConEstado.filter(s => s.estado !== 'al_dia' && s.email)
    if (objetivo.length === 0) {
      showToast('No hay socios pendientes con email registrado', 'error')
      return
    }
    if (!confirm(`¿Enviar recordatorio a ${objetivo.length} socios?`)) return
    setEnviandoMasivo(true)
    let ok = 0, err = 0
    for (const socio of objetivo) {
      const res = await enviarASocio(socio, { tipo: 'masivo' })
      if (res.ok) ok++; else err++
      // throttle suave para no saturar el rate limit de Resend
      await new Promise(r => setTimeout(r, 250))
    }
    setEnviandoMasivo(false)
    showToast(`Envío masivo: ${ok} enviados, ${err} con error`, err > 0 ? 'error' : 'success')
    loadEnvios()
  }

  const handleCopiarSocio = async (socio) => {
    const texto = [
      `Pago de cuota Teski Club ${anio}`,
      ``,
      datosBancariosTexto,
      ``,
      `Monto: ${formatearMontoConSimbolo(socio.pendiente || montoCuota)}`,
      `Referencia: ${socio.referencia}`,
    ].join('\n')
    const ok = await copiarPortapapeles(texto)
    showToast(ok ? 'Datos copiados al portapapeles' : 'No se pudo copiar', ok ? 'success' : 'error')
  }

  const handleCopiarBancarios = async () => {
    const ok = await copiarPortapapeles(datosBancariosTexto)
    showToast(ok ? 'Datos bancarios copiados' : 'No se pudo copiar', ok ? 'success' : 'error')
  }

  const handleToggleConfig = async (clave, nuevoValor) => {
    setConfig(prev => ({ ...prev, [clave]: nuevoValor }))
    const { error } = await supabase.from('config_club').update({ valor: nuevoValor }).eq('clave', clave)
    if (error) {
      showToast('Error guardando configuración', 'error')
      setConfig(prev => ({ ...prev, [clave]: prev[clave] === 'true' ? 'false' : 'true' }))
    }
  }

  const handleGuardarPlantilla = async () => {
    const guardar = async (clave, valor) => {
      const { data: existing } = await supabase.from('config_club').select('id').eq('clave', clave).maybeSingle()
      if (existing) {
        const { error } = await supabase.from('config_club').update({ valor: valor || '' }).eq('clave', clave)
        return !error
      }
      const { error } = await supabase.from('config_club').insert({ clave, valor: valor || '' })
      return !error
    }
    const okAsunto = await guardar('cobranza_asunto', asunto)
    const okCuerpo = await guardar('cobranza_cuerpo', cuerpo)
    if (!okAsunto || !okCuerpo) showToast('Error al guardar la plantilla', 'error')
    else showToast('Plantilla guardada correctamente')
  }

  const handleRestaurarTemplate = () => {
    setCuerpo(TEMPLATE_DEFAULT)
    setAsunto('Recordatorio de cuota social {anio} — Teski Club')
    showToast('Plantilla restaurada al default')
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div>
      {ToastComponent}

      {/* Selector de período + acciones rápidas */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'sans-serif' }}>Período:</label>
          <select
            value={selectedPeriodo?.id || ''}
            onChange={e => setSelectedPeriodo(periodos.find(p => p.id === e.target.value))}
            style={{ width: 'auto' }}
          >
            {periodos.map(p => <option key={p.id} value={p.id}>{p.anio} — ${p.monto.toLocaleString('es-CL')}</option>)}
          </select>
        </div>
        {editable && <button
          className="btn btn-primary"
          onClick={handleEnviarMasivo}
          disabled={enviandoMasivo || sociosConEstado.filter(s => s.estado !== 'al_dia' && s.email).length === 0}
          style={{ marginLeft: 'auto' }}
        >
          {enviandoMasivo
            ? <><i className="ti ti-loader"></i> Enviando…</>
            : <><i className="ti ti-send"></i> Enviar a todos los pendientes</>}
        </button>}
      </div>

      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: '1.5rem' }}>
        {[
          { label: 'Sin pago', value: resumen.sinPago, color: '#f09595' },
          { label: 'Pago parcial', value: resumen.parcial, color: '#fac775' },
          { label: 'Al día', value: resumen.alDia, color: '#5dcaa5' },
          { label: 'Pendiente total', value: formatearMontoConSimbolo(resumen.pendienteTotal), color: 'var(--gold-light)' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '1rem 1.25rem' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: 'sans-serif', marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{loading ? '—' : s.value}</div>
          </div>
        ))}
      </div>

      {/* Datos bancarios + Configuración */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginBottom: '1.5rem' }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-header">
            <div className="card-title"><i className="ti ti-building-bank"></i> Datos bancarios del club</div>
            <button className="btn btn-sm" onClick={handleCopiarBancarios}>
              <i className="ti ti-copy"></i> Copiar
            </button>
          </div>
          <div style={{ padding: '1rem 1.5rem', fontFamily: 'sans-serif', fontSize: 13, color: '#c8d0dc', lineHeight: 1.9 }}>
            {[
              ['Banco', config.banco_nombre],
              ['Tipo cuenta', config.banco_tipo_cuenta],
              ['N° cuenta', config.banco_numero_cuenta],
              ['RUT', config.banco_rut],
              ['Titular', config.banco_titular],
              ['Email', config.banco_email],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 12 }}>
                <span style={{ width: 110, color: 'var(--text-muted)' }}>{k}</span>
                <span style={{ color: 'var(--gold-light)' }}>{v || '—'}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-header">
            <div className="card-title"><i className="ti ti-settings"></i> Configuración de cobranza</div>
          </div>
          <div style={{ padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: 14, fontFamily: 'sans-serif', fontSize: 13 }}>
            {[
              { clave: 'cobranza_automatica', label: 'Envío automático mensual', hint: 'Requiere job programado (pg_cron). Actualmente solo activa el flag.' },
              { clave: 'cobranza_incluir_datos_bancarios', label: 'Incluir datos bancarios en el email', hint: 'Se reemplazan en la variable {datos_bancarios}.' },
              { clave: 'cobranza_copia_admin', label: 'Enviar copia al administrador', hint: `CC a ${config.banco_email || '(no configurado)'}` },
            ].map(t => {
              const active = config[t.clave] === 'true'
              return (
                <div key={t.clave} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ color: 'var(--text)' }}>{t.label}</div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 2 }}>{t.hint}</div>
                  </div>
                  <div
                    onClick={() => handleToggleConfig(t.clave, active ? 'false' : 'true')}
                    style={{
                      flexShrink: 0,
                      width: 38, height: 22, borderRadius: 12,
                      background: active ? 'var(--gold)' : 'rgba(201,168,76,0.15)',
                      border: '0.5px solid var(--border-strong)',
                      position: 'relative', cursor: 'pointer', transition: 'background 0.15s',
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: 2, left: active ? 18 : 2,
                      width: 16, height: 16, borderRadius: '50%',
                      background: active ? '#0a1628' : 'var(--gold-dim)',
                      transition: 'left 0.15s',
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Plantilla del email */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-mail-forward"></i> Plantilla del recordatorio</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm" onClick={handleRestaurarTemplate}>
              <i className="ti ti-refresh"></i> Restaurar default
            </button>
            <button className="btn btn-sm" onClick={handleGuardarPlantilla}>
              <i className="ti ti-device-floppy"></i> Guardar plantilla
            </button>
          </div>
        </div>
        <div style={{ padding: '1.25rem 1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="form-group" style={{ padding: 0 }}>
              <label>Asunto</label>
              <input value={asunto} onChange={e => setAsunto(e.target.value)} placeholder="Recordatorio de cuota..." />
            </div>
            <div className="form-group" style={{ padding: 0 }}>
              <label>Cuerpo (placeholders disponibles: {'{nombre} {anio} {monto_cuota} {monto_pagado} {monto_pendiente} {referencia} {datos_bancarios}'})</label>
              <textarea
                rows={16}
                value={cuerpo}
                onChange={e => setCuerpo(e.target.value)}
                style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              />
            </div>
          </div>
          <div style={{ background: 'var(--navy-mid)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem', overflow: 'auto' }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, fontFamily: 'sans-serif' }}>
              Vista previa {previewSocio ? `(${previewSocio.nombre} ${previewSocio.apellido})` : '(elegí un socio para ver con datos)'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--gold-light)', marginBottom: 8, fontFamily: 'sans-serif' }}>
              <strong>Asunto:</strong> {asuntoRendered}
            </div>
            <pre style={{ fontFamily: 'sans-serif', fontSize: 13, color: '#c8d0dc', whiteSpace: 'pre-wrap', margin: 0 }}>
              {cuerpoRendered}
            </pre>
          </div>
        </div>
      </div>

      {/* Tabla de socios */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-users"></i> Socios ({sociosFiltrados.length})</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={filtro} onChange={e => setFiltro(e.target.value)} style={{ width: 'auto' }}>
              <option value="pendientes">Pendientes</option>
              <option value="sin_pago">Sin pago</option>
              <option value="parcial">Pago parcial</option>
              <option value="todos">Todos</option>
            </select>
            <div className="search-box">
              <i className="ti ti-search"></i>
              <input placeholder="Buscar…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            </div>
          </div>
        </div>
        {loading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando socios…</div>
        ) : sociosFiltrados.length === 0 ? (
          <div className="empty-state"><i className="ti ti-mood-smile"></i>Nada que cobrar con este filtro</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Socio</th>
                <th>Email</th>
                <th>Pagado</th>
                <th>Pendiente</th>
                <th>Estado</th>
                <th>Referencia</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sociosFiltrados.map(s => {
                const ac = getAvatarColor(s.nombre || '')
                return (
                  <tr key={s.id}>
                    <td>
                      <div className="name-cell">
                        <div className="avatar" style={{ background: ac.bg, color: ac.color }}>
                          {s.nombre?.[0]}{s.apellido?.[0]}
                        </div>
                        <div>
                          <div>{s.nombre} {s.apellido}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{s.numero_socio}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {s.email || <span style={{ color: '#f09595' }}>sin email</span>}
                    </td>
                    <td className="amount-pos">{formatearMontoConSimbolo(s.pagado)}</td>
                    <td className="amount-neg">{formatearMontoConSimbolo(s.pendiente)}</td>
                    <td>
                      {s.estado === 'al_dia' && <span className="badge badge-active">Al día</span>}
                      {s.estado === 'parcial' && <span className="badge badge-pending">Parcial</span>}
                      {s.estado === 'sin_pago' && <span className="badge badge-inactive">Sin pago</span>}
                    </td>
                    <td>
                      <span className="chip" style={{ fontSize: 10 }}>{s.referencia}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-sm"
                          title="Ver vista previa con datos de este socio"
                          onClick={() => setPreviewSocio(s)}
                        >
                          <i className="ti ti-eye"></i>
                        </button>
                        <button
                          className="btn btn-sm"
                          title="Copiar datos bancarios + referencia"
                          onClick={() => handleCopiarSocio(s)}
                        >
                          <i className="ti ti-copy"></i>
                        </button>
                        {editable && (
                          <button
                            className="btn btn-sm"
                            title={s.email ? 'Enviar recordatorio' : 'Socio sin email'}
                            disabled={!s.email || enviando}
                            onClick={() => handleEnviarIndividual(s)}
                            style={{ color: s.email ? '#5dcaa5' : 'var(--text-dim)', borderColor: s.email ? 'rgba(29,158,117,0.4)' : 'var(--border)' }}
                          >
                            <i className={`ti ${enviando ? 'ti-loader' : 'ti-send'}`}></i>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Historial */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-history"></i> Historial de envíos ({envios.length})</div>
          <button className="btn btn-sm" onClick={loadEnvios}><i className="ti ti-refresh"></i> Actualizar</button>
        </div>
        {envios.length === 0 ? (
          <div className="empty-state"><i className="ti ti-inbox"></i>Aún no se han enviado recordatorios</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Socio</th>
                <th>Email</th>
                <th>Tipo</th>
                <th>Monto pendiente</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {envios.map(e => (
                <tr key={e.id}>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {new Date(e.created_at).toLocaleString('es-CL')}
                  </td>
                  <td>
                    {e.socios
                      ? <>{e.socios.nombre} {e.socios.apellido} <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 4 }}>{e.socios.numero_socio}</span></>
                      : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{e.email_destino || '—'}</td>
                  <td>
                    <span className="chip">{e.tipo}</span>
                  </td>
                  <td>{formatearMonto(e.monto_pendiente || 0)}</td>
                  <td>
                    {e.estado === 'enviado' && <span className="badge badge-active">Enviado</span>}
                    {e.estado === 'error' && (
                      <span className="badge badge-inactive" title={e.error_mensaje || ''}>
                        Error
                      </span>
                    )}
                    {e.estado === 'simulado' && <span className="badge badge-pending">Simulado</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
