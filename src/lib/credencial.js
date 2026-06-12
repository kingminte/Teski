import { supabase } from './supabase'

// Helpers compartidos del módulo Credencial Virtual.
// NOTA: el estado del socio NO se calcula acá — sale directo de
// socios.estado (decisión administrativa). Acá solo hay utilidades de
// presentación: año vigente, URL pública y filtro de beneficiarios.

// Año calendario actual (la "vigencia" de la credencial).
export const anioVigente = () => new Date().getFullYear()

// URL pública validable por QR. Usa el origin actual para que funcione
// igual en dev, preview y producción.
export const urlPublica = (token) =>
  token ? `${window.location.origin}/credencial/${token}` : ''

// Solo beneficiarios vigentes (la tabla usa estado 'vigente' | 'inactivo').
export const beneficiariosActivos = (lista) =>
  (lista || []).filter((b) => b.estado === 'vigente')

// Nombre completo de un socio/beneficiario.
export const nombreCompleto = (p) =>
  p ? `${p.nombre || ''} ${p.apellido || ''}`.trim() : ''

// Crea un token efímero (60s) para el socio vía RPC. Devuelve
// { token, expires_at } o null si falla (ej. sin conexión).
export const crearTokenEfimero = async (socioId) => {
  if (!socioId) return null
  const { data, error } = await supabase.rpc('crear_token_credencial', { p_socio_id: socioId })
  if (error || !data) return null
  const row = Array.isArray(data) ? data[0] : data
  return row ? { token: row.token, expires_at: row.expires_at } : null
}

// Fecha + hora de consulta, legible (es-CL). Para el pie de verificación.
export const fechaHoraConsulta = () =>
  new Date().toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
