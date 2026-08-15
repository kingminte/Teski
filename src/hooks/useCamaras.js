// src/hooks/useCamaras.js
//
// Lee los IDs de YouTube de las cámaras del Volcán Osorno desde la tabla
// camaras_externas, en vez de tenerlos escritos en el código.
//
// El operador (Andacor) reinicia las transmisiones cada cierto tiempo y
// YouTube emite un video ID nuevo, dejando muerto el embed anterior. El Edge
// Function sync-camaras los vuelve a resolver cada 15 minutos.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Nombre corto para el aviso de "no disponible". Solo presentación.
const NOMBRES_CORTOS = {
  boleterias: 'Boletería',
  cono: 'Cono',
}

/**
 * Devuelve las cámaras activas en el formato que espera CamaraCard:
 * { key, label, corto, videoId }
 *
 * Si Supabase no responde devuelve una lista vacía: es preferible que la UI
 * diga que no pudo cargar a que muestre IDs caducados que igual van a fallar.
 */
export function useCamaras() {
  const [camaras, setCamaras] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vigente = true

    async function cargar() {
      const { data, error: err } = await supabase
        .from('camaras_externas')
        .select('slug, nombre, youtube_id, estado, verificado_en')
        .eq('activa', true)
        .order('orden')

      if (!vigente) return

      if (err) {
        console.error('No se pudieron leer las cámaras:', err.message)
        setError(err.message)
        setCamaras([])
      } else {
        setError(null)
        setCamaras(
          (data ?? [])
            .filter((c) => c.youtube_id)
            .map((c) => ({
              key: c.slug,
              label: c.nombre,
              corto: NOMBRES_CORTOS[c.slug] ?? c.nombre,
              videoId: c.youtube_id,
              estado: c.estado,
              verificadoEn: c.verificado_en,
            })),
        )
      }

      setCargando(false)
    }

    cargar()

    // El job corre cada 15 min. Recargar al volver a la pestaña cubre el caso
    // de alguien que dejó la página abierta toda la mañana.
    const alVolver = () => {
      if (document.visibilityState === 'visible') cargar()
    }
    document.addEventListener('visibilitychange', alVolver)

    return () => {
      vigente = false
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [])

  return { camaras, cargando, error }
}
