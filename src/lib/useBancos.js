import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Hook que carga los bancos activos desde la base de datos
// Úsalo en cualquier página que necesite un desplegable de bancos
export function useBancos() {
  const [bancos, setBancos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('bancos').select('id,nombre').eq('activo', true).order('nombre')
      .then(({ data }) => {
        setBancos((data || []).map(b => b.nombre))
        setLoading(false)
      })
  }, [])

  return { bancos, loading }
}
