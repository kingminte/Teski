// Pestaña informativa "Nieve" — cámaras en vivo del Volcán Osorno y pronóstico.
// Puramente informativa: sin datos propios, sin Supabase. Solo iframes/fetch + CSS.
// Visible para cualquier usuario logueado (no usa permisos_rol).

import { useEffect, useRef, useState } from 'react'

// ── Pronóstico: Open-Meteo (gratis, sin API key, CORS ok) ──────────────────
const FORECAST_URL =
  'https://api.open-meteo.com/v1/forecast' +
  '?latitude=-41.12&longitude=-72.52&elevation=1230' +
  '&daily=temperature_2m_max,temperature_2m_min,snowfall_sum,precipitation_sum,weather_code,wind_speed_10m_max,wind_direction_10m_dominant' +
  '&hourly=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,snowfall,precipitation' +
  '&timezone=America/Santiago&forecast_days=7'

const SNOW_FORECAST_URL = 'https://www.snow-forecast.com/resorts/VolcanOsorno/6day/bot'
const CACHE_KEY = 'teski_nieve_forecast'
const CACHE_TTL = 60 * 60 * 1000 // 1 hora

const AZUL = '#6db5f0'   // nieve / cm destacados
const LLUVIA = '#7ea6d6' // íconos de lluvia

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
// Palabra completa en español para el banner (8 puntos cardinales).
const CARDINALES = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste']

const FRANJAS = [
  { label: 'Mañana', hora: 9 },
  { label: 'Mediodía', hora: 13 },
  { label: 'Tarde', hora: 16 },
]

// Fecha local (NUNCA new Date('YYYY-MM-DD') — parsea UTC y corre el día).
function parseLocalDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function dayLabel(ymd, index) {
  if (index === 0) return 'Hoy'
  return DIAS[parseLocalDate(ymd).getDay()]
}
function shortDate(ymd) {
  const dt = parseLocalDate(ymd)
  return `${dt.getDate()} ${MESES[dt.getMonth()]}`
}
function cardinalPalabra(grados) {
  return CARDINALES[Math.round(grados / 45) % 8]
}
// Abreviatura de 8 puntos en español (dirección DESDE donde viene el viento,
// convención meteorológica estándar de Open-Meteo — igual que cardinalPalabra).
const CARDINALES_ABREV = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
function cardinalAbrev(grados) {
  if (grados == null || isNaN(grados)) return ''
  return CARDINALES_ABREV[Math.round(grados / 45) % 8]
}
function horaCorta(ts) {
  return new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })
}
// Redondeo a 1 decimal como máximo, sin ceros colgando.
function n1(v) {
  return Math.round(v * 10) / 10
}
function windColor(v) {
  if (v > 40) return 'var(--danger)'
  if (v >= 20) return 'var(--warning)'
  return 'var(--text-muted)'
}
function hourlyIndex(hourly, ymd, hora) {
  return hourly.time.indexOf(`${ymd}T${String(hora).padStart(2, '0')}:00`)
}

// weather_code (WMO) → ícono Tabler + texto ES + color. Fallback: nublado.
function weatherInfo(code) {
  if (code === 0) return { icon: 'ti-sun', text: 'despejado', color: 'var(--gold-light)' }
  if (code === 1 || code === 2) return { icon: 'ti-sun-low', text: 'parcial', color: 'var(--gold-light)' }
  if (code === 3) return { icon: 'ti-cloud', text: 'nublado', color: 'var(--text-muted)' }
  if (code === 45 || code === 48) return { icon: 'ti-cloud-fog', text: 'niebla', color: 'var(--text-muted)' }
  if (code >= 51 && code <= 57) return { icon: 'ti-cloud-rain', text: 'llovizna', color: LLUVIA }
  if (code >= 61 && code <= 67) return { icon: 'ti-cloud-rain', text: 'lluvia', color: LLUVIA }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: 'ti-snowflake', text: 'nieve', color: AZUL }
  if (code >= 80 && code <= 82) return { icon: 'ti-cloud-rain', text: 'chubascos', color: LLUVIA }
  if (code >= 95 && code <= 99) return { icon: 'ti-cloud-storm', text: 'tormenta', color: LLUVIA }
  return { icon: 'ti-cloud', text: 'nublado', color: 'var(--text-muted)' }
}

// fetch con cache en sessionStorage (< 1h reutiliza sin llamar de nuevo).
async function fetchForecast() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (raw) {
      const cached = JSON.parse(raw)
      if (cached?.data && Date.now() - cached.ts < CACHE_TTL) {
        return { data: cached.data, ts: cached.ts }
      }
    }
  } catch { /* cache corrupto: ignorar y refrescar */ }

  const res = await fetch(FORECAST_URL)
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const data = await res.json()
  const ts = Date.now()
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts, data }))
  } catch { /* storage lleno/bloqueado: seguir sin cache */ }
  return { data, ts }
}

function SnowForecastLink() {
  return (
    <a
      href={SNOW_FORECAST_URL}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: 'var(--gold)', fontSize: 12, textDecoration: 'underline', fontFamily: 'sans-serif' }}
    >
      Ver pronóstico completo en Snow-Forecast.com
    </a>
  )
}

function WindArrow({ deg }) {
  // La flecha muestra el FLUJO: apunta hacia DÓNDE VA el viento (formato Windy).
  // Open-Meteo entrega la dirección DESDE donde viene → +180 para invertir al
  // sentido del movimiento. Es INTENCIONALMENTE distinta de la abreviatura de
  // texto (cardinalAbrev), que usa la convención meteorológica estándar (DESDE
  // dónde viene): la flecha es el movimiento, el texto es el origen — igual que
  // Windy y otros servicios.
  return (
    <i
      className="ti ti-arrow-narrow-up"
      style={{ display: 'inline-block', transform: `rotate(${deg + 180}deg)`, fontSize: 15, color: 'var(--text-muted)' }}
    />
  )
}

function bannerTexto(daily) {
  // 1ª nevada de los 7 días.
  const idxNieve = daily.snowfall_sum.findIndex(v => v > 0)
  let texto = idxNieve >= 0
    ? `Próxima nevada: ${dayLabel(daily.time[idxNieve], idxNieve)} (~${n1(daily.snowfall_sum[idxNieve])} cm).`
    : 'Sin nieve pronosticada esta semana.'

  // Viento fuerte en los próximos 3 días.
  for (let i = 0; i < Math.min(3, daily.time.length); i++) {
    if (daily.wind_speed_10m_max[i] > 40) {
      const dia = dayLabel(daily.time[i], i)
      const dir = cardinalPalabra(daily.wind_direction_10m_dominant[i])
      const p = daily.precipitation_sum[i]
      const precip = p > 20 ? 'lluvia fuerte' : p > 2 ? 'lluvia' : null
      texto += precip
        ? ` ${dia} con ${precip} y viento ${dir} sobre 40 km/h.`
        : ` ${dia} con viento ${dir} sobre 40 km/h.`
      break
    }
  }
  return texto
}

// Resumen "min° / max° · nieve/lluvia" de un día del bloque daily.
function ResumenDia({ daily, i, orden = 'minmax' }) {
  const max = Math.round(daily.temperature_2m_max[i])
  const min = Math.round(daily.temperature_2m_min[i])
  const snow = daily.snowfall_sum[i]
  const precip = daily.precipitation_sum[i]
  const temps = orden === 'maxmin' ? `${max}° / ${min}°` : `${min}° / ${max}°`
  return (
    <span style={{ fontFamily: 'sans-serif', fontSize: 12, color: 'var(--text-muted)' }}>
      {temps}
      {snow > 0 ? (
        <span style={{ color: AZUL, fontWeight: 600 }}> · {n1(snow)} cm</span>
      ) : precip > 0 ? (
        <span> · {n1(precip)} mm</span>
      ) : null}
    </span>
  )
}

function DetalleDia({ daily, hourly, i }) {
  const ymd = daily.time[i]
  const hoy = i === 0
  return (
    <div style={{
      border: `0.5px solid ${hoy ? 'var(--border-strong)' : 'var(--border)'}`,
      borderRadius: 10,
      background: hoy ? 'rgba(201,168,76,0.06)' : 'rgba(10,22,40,0.35)',
      padding: '0.85rem 1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'sans-serif', fontSize: 13, color: hoy ? 'var(--gold-light)' : '#c8d0dc', fontWeight: 600 }}>
          {dayLabel(ymd, i)} · {shortDate(ymd)}
        </span>
        <ResumenDia daily={daily} i={i} orden="minmax" />
      </div>
      {FRANJAS.map(f => {
        const idx = hourlyIndex(hourly, ymd, f.hora)
        const wi = idx >= 0 ? weatherInfo(hourly.weather_code[idx]) : null
        const ws = idx >= 0 ? Math.round(hourly.wind_speed_10m[idx]) : null
        return (
          <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'sans-serif', fontSize: 12, padding: '3px 0' }}>
            <span style={{ width: 54, flexShrink: 0, color: 'var(--text-muted)' }}>{f.label}</span>
            {idx >= 0 ? (
              <>
                <i className={`ti ${wi.icon}`} title={wi.text} style={{ fontSize: 16, width: 18, textAlign: 'center', flexShrink: 0, color: wi.color }} />
                <span style={{ width: 34, flexShrink: 0, color: 'var(--text)' }}>{Math.round(hourly.temperature_2m[idx])}°</span>
                <span style={{ flex: 1 }} />
                <WindArrow deg={hourly.wind_direction_10m[idx]} />
                <span style={{ width: 24, flexShrink: 0, textAlign: 'right', color: 'var(--text-muted)' }}>{cardinalAbrev(hourly.wind_direction_10m[idx])}</span>
                <span style={{ width: 52, flexShrink: 0, textAlign: 'right', color: windColor(ws), fontWeight: ws > 40 ? 500 : 400 }}>{ws} km/h</span>
              </>
            ) : (
              <span style={{ color: 'var(--text-dim)' }}>—</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function DiaCompacto({ daily, i }) {
  const ymd = daily.time[i]
  const wi = weatherInfo(daily.weather_code[i])
  const snow = daily.snowfall_sum[i]
  const precip = daily.precipitation_sum[i]
  const wmax = Math.round(daily.wind_speed_10m_max[i])
  return (
    <div style={{
      border: '0.5px solid var(--border)', borderRadius: 10, background: 'rgba(10,22,40,0.35)',
      padding: '0.75rem', textAlign: 'center', fontFamily: 'sans-serif',
    }}>
      <div style={{ fontSize: 12, color: '#c8d0dc', fontWeight: 600, marginBottom: 4 }}>{dayLabel(ymd, i)}</div>
      <i className={`ti ${wi.icon}`} title={wi.text} style={{ fontSize: 24, color: wi.color }} />
      <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0' }}>
        {Math.round(daily.temperature_2m_max[i])}° / {Math.round(daily.temperature_2m_min[i])}°
      </div>
      <div style={{ fontSize: 12, minHeight: 16 }}>
        {snow > 0 ? (
          <span style={{ color: AZUL, fontWeight: 600 }}>{n1(snow)} cm</span>
        ) : precip > 0 ? (
          <span style={{ color: 'var(--text-muted)' }}>{n1(precip)} mm</span>
        ) : (
          <span style={{ color: 'var(--text-dim)' }}>—</span>
        )}
      </div>
      <div style={{ fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <i className="ti ti-wind" style={{ fontSize: 14, color: 'var(--text-dim)' }} />
        <span style={{ color: windColor(wmax), fontWeight: wmax > 40 ? 500 : 400 }}>{cardinalAbrev(daily.wind_direction_10m_dominant[i])} {wmax} km/h</span>
      </div>
    </div>
  )
}

function Pronostico() {
  const [state, setState] = useState({ status: 'loading', data: null, ts: null })

  useEffect(() => {
    let alive = true
    fetchForecast()
      .then(({ data, ts }) => { if (alive) setState({ status: 'ready', data, ts }) })
      .catch(() => { if (alive) setState({ status: 'error', data: null, ts: null }) })
    return () => { alive = false }
  }, [])

  const daily = state.data?.daily
  const hourly = state.data?.hourly
  const listo = state.status === 'ready' && daily && hourly && Array.isArray(daily.time) && daily.time.length > 0

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><i className="ti ti-cloud-snow"></i> Pronóstico · base (1230 m)</div>
        {listo && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
            Actualizado {horaCorta(state.ts)}
          </span>
        )}
      </div>
      <div style={{ padding: '1.25rem 1.5rem' }}>
        {state.status === 'loading' && (
          <div style={{ color: 'var(--text-muted)', fontFamily: 'sans-serif', fontSize: 13, padding: '1rem 0' }}>
            Cargando pronóstico…
          </div>
        )}

        {state.status === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--text-muted)', fontFamily: 'sans-serif', fontSize: 13, padding: '1rem 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="ti ti-cloud-off" style={{ fontSize: 20, color: 'var(--text-dim)' }} />
              Pronóstico no disponible
            </div>
            <SnowForecastLink />
          </div>
        )}

        {listo && (
          <>
            {/* Banner resumen */}
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              background: 'rgba(109,181,240,0.08)', border: '0.5px solid rgba(109,181,240,0.25)',
              borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1.25rem',
            }}>
              <i className="ti ti-snowflake" style={{ fontSize: 20, color: AZUL, flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontFamily: 'sans-serif', fontSize: 13, color: '#d3dbe8', lineHeight: 1.5 }}>
                {bannerTexto(daily)}
              </span>
            </div>

            {/* Detalle 3 días (hoy + 2) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
              {[0, 1, 2].filter(i => i < daily.time.length).map(i => (
                <DetalleDia key={daily.time[i]} daily={daily} hourly={hourly} i={i} />
              ))}
            </div>

            {/* Resto de la semana (días 4 a 7) */}
            {daily.time.length > 3 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                {[3, 4, 5, 6].filter(i => i < daily.time.length).map(i => (
                  <DiaCompacto key={daily.time[i]} daily={daily} i={i} />
                ))}
              </div>
            )}

            {/* Pie */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
              marginTop: '1.25rem', paddingTop: '0.85rem', borderTop: '0.5px solid var(--border)',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'sans-serif' }}>
                Datos: Open-Meteo · Viento: <span style={{ color: 'var(--text-muted)' }}>gris &lt;20</span> · <span style={{ color: 'var(--warning)' }}>ámbar 20–40</span> · <span style={{ color: 'var(--danger)' }}>rojo &gt;40</span> km/h
              </span>
              <SnowForecastLink />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// El Centro Volcán Osorno emite por YouTube Live. Los IDs pueden CADUCAR si el
// centro corta y reinicia la transmisión: cuando eso pase, el player reporta
// onError y mostramos el aviso propio. Recuperar el ID es MANUAL (editar aquí).
const CAMARAS = [
  { key: 'boleterias', label: 'Boleterías (base)', corto: 'Boletería', videoId: 'BhJ-RasFPTM' },
  { key: 'cono', label: 'Cono del volcán', corto: 'Cono', videoId: '2uBn7TRSYjI' },
]

// Carga la YouTube IFrame Player API UNA sola vez (script global compartido).
let ytApiPromise = null
function loadYouTubeAPI() {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT)
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); resolve(window.YT) }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  })
  return ytApiPromise
}

function CamaraCard({ label, corto, videoId }) {
  const holderRef = useRef(null)      // div que YT reemplaza por su iframe
  const playerRef = useRef(null)
  const [estado, setEstado] = useState('cargando')   // cargando | ok | error

  useEffect(() => {
    let cancelado = false
    setEstado('cargando')
    loadYouTubeAPI().then((YT) => {
      if (cancelado || !YT || !holderRef.current) return
      playerRef.current = new YT.Player(holderRef.current, {
        videoId,
        playerVars: { autoplay: 1, mute: 1, playsinline: 1, rel: 0 },
        events: {
          // mute + play explícitos: refuerzan el autoplay silenciado.
          onReady: (e) => { try { e.target.mute(); e.target.playVideo() } catch { /* noop */ } },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING) setEstado('ok')
          },
          // ID caducado / video no disponible / embed bloqueado → aviso propio.
          onError: () => setEstado('error'),
        },
      })
    })
    return () => {
      cancelado = true
      try { playerRef.current?.destroy?.() } catch { /* noop */ }
      playerRef.current = null
    }
  }, [videoId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Marco 16:9. El player de YT vive en el holder; si falla, superponemos
          el aviso propio SOLO sobre esta cámara (la otra sigue andando). */}
      <div style={{
        position: 'relative', aspectRatio: '16 / 9', width: '100%',
        background: 'var(--navy)', border: '0.5px solid var(--border)',
        borderRadius: 10, overflow: 'hidden',
      }}>
        {/* Contenedor del player (YT reemplaza el div interno por su iframe) */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <div ref={holderRef} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* Aviso propio de cámara no disponible (por cámara) */}
        {estado === 'error' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8, padding: '1rem',
            textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'sans-serif', fontSize: 13,
            background: 'var(--navy)',
          }}>
            <i className="ti ti-video-off" style={{ fontSize: 28, color: 'var(--text-dim)' }}></i>
            <div>La transmisión de la cámara {corto} no está disponible en este momento.</div>
            <a
              href="https://centrovolcanosorno.cl/live-cam/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--gold)', fontSize: 12, textDecoration: 'underline' }}
            >
              Ver en el sitio del centro
            </a>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'sans-serif' }}>
        {estado !== 'error' && (
          <>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)',
              boxShadow: '0 0 0 3px rgba(226,75,74,0.2)', flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, color: 'var(--danger)', letterSpacing: 1, textTransform: 'uppercase' }}>Live</span>
          </>
        )}
        <span style={{ fontSize: 13, color: '#c8d0dc' }}>{label}</span>
      </div>
    </div>
  )
}

export default function Nieve() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 22, color: 'var(--gold-light)', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="ti ti-snowflake" style={{ fontSize: 24, color: 'var(--gold)' }}></i>
          Nieve · Volcán Osorno
        </h1>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 10px', borderRadius: 999,
          background: 'rgba(226,75,74,0.12)', border: '0.5px solid rgba(226,75,74,0.4)',
          color: 'var(--danger)', fontFamily: 'sans-serif', fontSize: 11,
          letterSpacing: 1, textTransform: 'uppercase',
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--danger)' }} />
          En vivo
        </span>
      </div>

      {/* Cámaras en vivo */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-video"></i> Cámaras en vivo</div>
        </div>
        <div style={{ padding: '1.25rem 1.5rem' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '1.25rem',
          }}>
            {CAMARAS.map(cam => (
              <CamaraCard key={cam.key} label={cam.label} corto={cam.corto} videoId={cam.videoId} />
            ))}
          </div>
        </div>
      </div>

      {/* Pronóstico propio — datos de Open-Meteo */}
      <Pronostico />
    </div>
  )
}
