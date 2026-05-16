import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

const USER_FALLBACK = { nombre: 'Sin perfil', username: '—', rol: 'admin', virtual: true }

export function AuthProvider({ children, session }) {
  const [user, setUser] = useState(null)
  const [permisos, setPermisos] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session?.user?.email) { setUser(null); setPermisos({}); setLoading(false); return }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data: u } = await supabase
        .from('usuarios')
        .select('*')
        .eq('email', session.user.email)
        .eq('activo', true)
        .maybeSingle()

      const efectivo = u || USER_FALLBACK
      if (cancelled) return
      setUser(efectivo)

      const { data: perms } = await supabase.from('permisos_rol').select('seccion,nivel').eq('rol', efectivo.rol)
      if (cancelled) return
      const map = {}
      ;(perms || []).forEach(p => { map[p.seccion] = p.nivel })
      setPermisos(map)
      setLoading(false)

      if (u) await supabase.from('usuarios').update({ ultimo_acceso: new Date().toISOString() }).eq('id', u.id)
    })()
    return () => { cancelled = true }
  }, [session?.user?.email])

  const tieneAcceso = (seccion) => {
    if (!user) return false
    if (user.rol === 'admin') return true
    const n = permisos[seccion]
    return n === 'completo' || n === 'lectura'
  }

  const puedeEditar = (seccion) => {
    if (!user) return false
    if (user.rol === 'admin') return true
    return permisos[seccion] === 'completo'
  }

  const esAdmin = () => user?.rol === 'admin'

  return (
    <AuthContext.Provider value={{ user, permisos, loading, tieneAcceso, puedeEditar, esAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext) || { user: null, permisos: {}, loading: true, tieneAcceso: () => false, puedeEditar: () => false, esAdmin: () => false }
