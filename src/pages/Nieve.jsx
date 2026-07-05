// Pestaña informativa "Nieve" — cámaras en vivo del Volcán Osorno y pronóstico.
// Puramente informativa: sin datos propios, sin Supabase. Solo iframes + CSS.
// Visible para cualquier usuario logueado (no usa permisos_rol).

const CAMARAS = [
  {
    alias: 'boleteriasvo',
    label: 'Boleterías (base)',
    src: 'https://g3.ipcamlive.com/player/player.php?alias=boleteriasvo&autoplay=1',
  },
  {
    alias: 'volcanosornocono',
    label: 'Cono del volcán',
    src: 'https://g3.ipcamlive.com/player/player.php?alias=volcanosornocono&autoplay=1',
  },
]

function CamaraCard({ label, src }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Marco 16:9. La capa de fallback queda debajo del iframe: si el
          iframe no carga, el mensaje asoma por detrás. */}
      <div style={{
        position: 'relative', aspectRatio: '16 / 9', width: '100%',
        background: 'var(--navy)', border: '0.5px solid var(--border)',
        borderRadius: 10, overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8, padding: '1rem',
          textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'sans-serif', fontSize: 13,
        }}>
          <i className="ti ti-video-off" style={{ fontSize: 28, color: 'var(--text-dim)' }}></i>
          <div>Cámara no disponible</div>
          <a
            href="https://centrovolcanosorno.cl/live-cam/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--gold)', fontSize: 12, textDecoration: 'underline' }}
          >
            Ver cámaras en el sitio del centro
          </a>
        </div>
        <iframe
          title={label}
          src={src}
          loading="lazy"
          allow="autoplay; fullscreen"
          allowFullScreen
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            border: 'none', display: 'block',
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'sans-serif' }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)',
          boxShadow: '0 0 0 3px rgba(226,75,74,0.2)', flexShrink: 0,
        }} />
        <span style={{ fontSize: 11, color: 'var(--danger)', letterSpacing: 1, textTransform: 'uppercase' }}>Live</span>
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
              <CamaraCard key={cam.alias} label={cam.label} src={cam.src} />
            ))}
          </div>
        </div>
      </div>

      {/* Pronóstico — widget oficial de snow-forecast.com */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-cloud-snow"></i> Pronóstico · snow-forecast.com</div>
        </div>
        <div style={{ padding: '1.25rem 1.5rem' }}>
          <div id="weatherfeed">
            <iframe
              allowTransparency="true"
              frameBorder="0"
              height="100%"
              marginHeight="0"
              marginWidth="0"
              scrolling="no"
              src="https://www.snow-forecast.com/resorts/VolcanOsorno/forecasts/widget/mid/m"
              style={{ overflow: 'hidden', border: 'none', width: '100%', minHeight: 350, height: '100%', display: 'block' }}
              title="Weather forecast for Volcán Osorno"
              width="100%"
            >
              <p>Your browser does not support iframes.</p>
            </iframe>
            {/* Link de vuelta obligatorio por la licencia gratuita del widget: no ocultar. */}
            <a
              href="https://www.snow-forecast.com/resorts/VolcanOsorno/6day/mid?utm_source=embeddable&utm_medium=widget&utm_campaign=VolcanOsorno"
              target="_blank"
              rel="noopener noreferrer"
            >
              <div style={{ fontSize: 14, textAlign: 'center', color: 'var(--text-muted)', padding: '8px 8px 0' }}>
                View the full Volcán Osorno forecast at{' '}
                <span style={{ textDecoration: 'underline' }}>Snow-Forecast.com</span>
              </div>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
