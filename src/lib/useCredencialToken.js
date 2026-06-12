import { useEffect, useState } from 'react'
import { crearTokenEfimero } from './credencial'

const VENTANA = 60 // segundos de vida de cada token

// Genera un token efímero para el socio y lo rota automáticamente cada 60s
// mientras `activo` sea true. Devuelve:
//   token       → string vigente, o null si falló (sin conexión)
//   segundos    → segundos restantes hasta la próxima rotación
//   total       → ventana total (60), para la barra de progreso
//   sinConexion → true si la última generación falló
// La rotación no parpadea: el token viejo se mantiene en pantalla hasta que
// llega el nuevo.
export function useCredencialToken(socioId, activo = true) {
  const [token, setToken] = useState(null)
  const [segundos, setSegundos] = useState(VENTANA)
  const [sinConexion, setSinConexion] = useState(false)

  useEffect(() => {
    if (!socioId || !activo) { setToken(null); setSegundos(VENTANA); return }
    let cancelado = false
    let expiresMs = 0

    const generar = async () => {
      const res = await crearTokenEfimero(socioId)
      if (cancelado) return
      if (!res) { setToken(null); setSinConexion(true); return }
      setSinConexion(false)
      setToken(res.token)
      expiresMs = new Date(res.expires_at).getTime()
      setSegundos(Math.max(0, Math.round((expiresMs - Date.now()) / 1000)))
    }

    const tick = () => {
      if (!expiresMs) return
      const restante = Math.max(0, Math.round((expiresMs - Date.now()) / 1000))
      setSegundos(restante)
      if (restante <= 0) { expiresMs = 0; generar() } // rotar sin limpiar el token actual
    }

    generar()
    const id = setInterval(tick, 1000)
    return () => { cancelado = true; clearInterval(id) }
  }, [socioId, activo])

  return { token, segundos, total: VENTANA, sinConexion }
}
