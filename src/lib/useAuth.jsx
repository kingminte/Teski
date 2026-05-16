import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

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
    return { debe_cambiar_clave: !!data.debe_cambiar_clave, user: data }
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

  return (
    <AuthContext.Provider value={{ user: userProp, permisos, login, logout, tieneAcceso, puedeEditar, esAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext) || {
  user: null, permisos: {},
  login: async () => { throw new Error('AuthProvider no montado') },
  logout: () => {},
  tieneAcceso: () => false, puedeEditar: () => false, esAdmin: () => false,
}
