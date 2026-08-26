import { supabase } from './supabase'

// Helpers compartidos del módulo Credencial Virtual.
// NOTA: el estado del socio NO se calcula acá — sale directo de
// socios.estado (decisión administrativa). Acá solo hay utilidades de
// presentación: año vigente, URL pública y filtro de beneficiarios.

// Año calendario actual (la "vigencia" de la credencial).
export const anioVigente = () => new Date().getFullYear()

// URL pública validable por QR. Usa el origin actual para que funcione
// igual en dev, preview y producción.
// El token es ESTABLE por socio (socios.credencial_token): el QR vale toda
// la temporada y sirve como pantallazo. La seguridad no está en la rotación
// sino en que /credencial-publica consulta el estado ACTUAL del socio.
export const urlPublica = (token) =>
  token ? `${window.location.origin}/credencial-publica?t=${token}` : ''

// Solo beneficiarios vigentes (la tabla usa estado 'vigente' | 'inactivo').
export const beneficiariosActivos = (lista) =>
  (lista || []).filter((b) => b.estado === 'vigente')

// Nombre completo de un socio/beneficiario.
export const nombreCompleto = (p) =>
  p ? `${p.nombre || ''} ${p.apellido || ''}`.trim() : ''

// Regenera el token del socio: el QR anterior (y sus pantallazos) dejan de
// validar. El uuid se genera en el cliente porque PostgREST no permite
// llamar gen_random_uuid() dentro de un UPDATE.
// Devuelve el nuevo token, o null si falló.
export const regenerarCredencialToken = async (socioId) => {
  if (!socioId) return null
  const nuevo = crypto.randomUUID()
  const { error } = await supabase.from('socios')
    .update({ credencial_token: nuevo })
    .eq('id', socioId)
  return error ? null : nuevo
}

// Fecha + hora de consulta, legible (es-CL). Para el pie de verificación.
export const fechaHoraConsulta = () =>
  new Date().toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
