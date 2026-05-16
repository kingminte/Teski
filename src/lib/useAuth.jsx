import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

// Orden de prioridad para decidir landing tras login
const SECCION_A_RUTA = [
  ['dashboard', '/dashboard'],
  ['socios', '/socios'],
  ['beneficiarios', '/beneficiarios'],
  ['cuotas', '/cuotas'],
  ['socios_activos', '/socios-activos'],
  ['cartola', '/cartola'],
  ['cheques', '/cheques'],
  ['chequera', '/chequera'],
  ['cuentas_por_pagar', '/cuentas-por-pagar'],
  ['cobranza', '/cobranza'],
  ['configuracion', '/bancos'],
  ['reporteria', '/reporteria'],
  ['usuarios', '/usuarios'],
]

function calcularRutaInicial(rol, permisosMap) {
  if (rol === 'admin') return '/dashboard'
  for (const [seccion, ruta] of SECCION_A_RUTA) {
    const n = permisosMap[seccion]
    if (n === 'completo' || n === 'lectura') return ruta
  }
  return '/dashboard'
}

export async function hashPassword(pass) {
  const enc = new TextEncoder().encode(pass)
  const hash = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function loadUserFromStorage() {
  try {
    const raw = localStorage.getItem('teski_user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children, user: userProp, onUserChange }) {
  const [permisos, setPermisos] = useState({})

  useEffect(() => {
    if (!userProp?.rol) { setPermisos({}); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('permisos_rol').select('seccion,nivel').eq('rol', userProp.rol)
      if (cancelled) return
      const map = {}
      ;(data || []).forEach(p => { map[p.seccion] = p.nivel })
      setPermisos(map)
    })()
    return () => { cancelled = true }
  }, [userProp?.rol])

  const login = async (username, password) => {
    const passHash = await hashPassword(password)
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('username', username.trim().toLowerCase())
      .eq('password_hash', passHash)
      .eq('activo', true)
      .maybeSingle()
    if (error) throw new Error('Error al conectar con el servidor')
    if (!data) throw new Error('Usuario o contraseña incorrectos')
    await supabase.from('usuarios').update({ ultimo_acceso: new Date().toISOString() }).eq('id', data.id)
    localStorage.setItem('teski_user', JSON.stringify(data))
    onUserChange?.(data)

    const { data: perms } = await supabase.from('permisos_rol').select('seccion,nivel').eq('rol', data.rol)
    const permisosMap = {}
    ;(perms || []).forEach(p => { permisosMap[p.seccion] = p.nivel })
    const rutaInicial = calcularRutaInicial(data.rol, permisosMap)

    return { debe_cambiar_clave: !!data.debe_cambiar_clave, user: data, rutaInicial }
  }

  const logout = () => {
    localStorage.removeItem('teski_user')
    onUserChange?.(null)
  }

  const tieneAcceso = (seccion) => {
    if (!userProp) return false
    if (userProp.rol === 'admin') return true
    const n = permisos[seccion]
    return n === 'completo' || n === 'lectura'
  }

  const puedeEditar = (seccion) => {
    if (!userProp) return false
    if (userProp.rol === 'admin') return true
    return permisos[seccion] === 'completo'
  }

  const esAdmin = () => userProp?.rol === 'admin'

  const primeraRutaPermitida = () => {
    if (!userProp) return '/login'
    return calcularRutaInicial(userProp.rol, permisos)
  }

  return (
    <AuthContext.Provider value={{ user: userProp, permisos, login, logout, tieneAcceso, puedeEditar, esAdmin, primeraRutaPermitida }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext) || {
  user: null, permisos: {},
  login: async () => { throw new Error('AuthProvider no montado') },
  logout: () => {},
  tieneAcceso: () => false, puedeEditar: () => false, esAdmin: () => false,
  primeraRutaPermitida: () => '/dashboard',
}
