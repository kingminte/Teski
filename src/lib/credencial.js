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

// Token alfanumérico de 16 chars (para rotar el token desde el cliente).
// El unique de la BD atrapa cualquier colisión; el caller reintenta.
export const generarToken = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let t = ''
  for (let i = 0; i < 16; i++) t += chars[Math.floor(Math.random() * chars.length)]
  return t
}

// Fecha + hora de consulta, legible (es-CL). Para el pie de verificación.
export const fechaHoraConsulta = () =>
  new Date().toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
