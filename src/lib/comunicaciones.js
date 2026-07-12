import { supabase } from './supabase'

// Motor del módulo "Avisos por email". Capa central de la que cuelgan los
// avisos de otros módulos. El envío real lo hace la Edge Function genérica
// `enviar-email` (Resend). Cobranza tiene su propio cartero (enviar-cobranza).

// Reemplaza {clave} por su valor (mismo patrón que usa Cobranza).
export function renderPlantilla(texto, variables = {}) {
  return Object.entries(variables).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v ?? '')),
    texto || '',
  )
}

// Invoca la Edge Function enviar-email. Devuelve { ok, error }.
export async function enviarEmail({ destinatario, asunto, html, copia }) {
  const { data, error } = await supabase.functions.invoke('enviar-email', {
    body: { destinatario, asunto, html, ...(copia ? { copia } : {}) },
  })
  if (error || data?.error) {
    return { ok: false, error: error?.message || data?.error || 'Error desconocido' }
  }
  return { ok: true }
}

// Registro best-effort en comunicaciones_envios (nunca lanza).
async function registrarEnvio(row) {
  try { await supabase.from('comunicaciones_envios').insert(row) } catch { /* noop */ }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Estados de socio configurados para recibir avisos de la Escuela
// (config_club.avisos_escuela_estados, lista separada por coma).
export async function estadosAvisosEscuela() {
  const { data } = await supabase.from('config_club')
    .select('valor').eq('clave', 'avisos_escuela_estados').maybeSingle()
  return (data?.valor || '').split(',').map(s => s.trim()).filter(Boolean)
}

// Socios que deben recibir un aviso MASIVO de la Escuela, aplicando la
// intersección de DOS filtros:
//   1) estado del socio ∈ estados configurados (config_club.avisos_escuela_estados)
//   2) socios.recibe_avisos_escuela = true (consentimiento individual)
// Devuelve [{ email, socio_id, nombre }] para que el caller arme las variables.
export async function resolverDestinatariosEscuela() {
  const estados = await estadosAvisosEscuela()
  if (estados.length === 0) return []
  const { data } = await supabase.from('socios')
    .select('id, nombre, apellido, email')
    .in('estado', estados)
    .eq('recibe_avisos_escuela', true)
  return (data || []).map(s => ({
    email: s.email || '',
    socio_id: s.id,
    nombre: `${s.nombre} ${s.apellido}`,
  }))
}

// Corazón del motor. Dado un aviso (clave de plantilla) y una lista de
// destinatarios [{ email, socio_id, variables }], resuelve la plantilla,
// renderiza, envía y registra cada envío.
//   - Si la plantilla no existe o está inactiva → NO envía (respeta el switch).
//   - email vacío → registra error 'sin email' y sigue.
//   - throttle ~250ms entre envíos (rate limit de Resend).
//   - Best-effort: TODO en try/catch; nunca lanza al caller (un fallo de email
//     no debe romper la acción que lo disparó).
export async function dispatchAviso(clave, destinatarios = [], contextoBase = {}) {
  try {
    const { data: plantilla } = await supabase
      .from('comunicaciones_plantillas')
      .select('*')
      .eq('clave', clave)
      .maybeSingle()

    if (!plantilla || !plantilla.activo) {
      return { ok: false, omitido: true, enviados: 0, errores: 0 }
    }

    let enviados = 0, errores = 0
    for (let i = 0; i < destinatarios.length; i++) {
      const d = destinatarios[i]
      const vars = d.variables || {}
      const asunto = renderPlantilla(plantilla.asunto, vars)
      const contexto = { ...contextoBase, ...vars }

      if (!d.email) {
        errores++
        await registrarEnvio({
          plantilla_clave: clave, socio_id: d.socio_id || null, email_destino: null,
          asunto, estado: 'error', error_mensaje: 'sin email', contexto,
        })
        continue
      }

      const html = renderPlantilla(plantilla.cuerpo_html, vars)
      const res = await enviarEmail({ destinatario: d.email, asunto, html })
      if (res.ok) enviados++; else errores++
      await registrarEnvio({
        plantilla_clave: clave, socio_id: d.socio_id || null, email_destino: d.email,
        asunto, estado: res.ok ? 'enviado' : 'error', error_mensaje: res.ok ? null : res.error,
        contexto,
      })

      // throttle entre envíos (no tras el último)
      if (i < destinatarios.length - 1) await sleep(250)
    }
    return { ok: errores === 0, omitido: false, enviados, errores }
  } catch (e) {
    return { ok: false, error: e?.message || 'Error en dispatchAviso', enviados: 0, errores: 0 }
  }
}
