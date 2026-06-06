import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAuth, tiempoRestanteSesion } from '../lib/useAuth'
import logo from '../assets/logo.png'

const PATH_SECCION = {
  '/dashboard': 'dashboard',
  '/socios': 'socios',
  '/beneficiarios': 'beneficiarios',
  '/socios-activos': 'socios_activos',
  '/cuotas': 'cuotas',
  '/cartola': 'cartola',
  '/cheques': 'cheques',
  '/chequera': 'chequera',
  '/cuentas-por-pagar': 'cuentas_por_pagar',
  '/otros-ingresos': 'otros_ingresos',
  '/cobranza': 'cobranza',
  '/bancos': 'configuracion',
  '/reporteria': 'reporteria',
  '/reporte-financiero': 'reporteria',
  '/usuarios': 'usuarios',
  '/clases/solicitar': 'clases_solicitar',
  '/clases/gestion': 'clases_gestion',
  '/clases/catalogos': 'clases_catalogos',
  '/clases/config': 'clases_config',
  '/clases/reporte': 'clases_reporte',
}

const ROL_META = {
  admin: { label: 'Administrador', background: 'rgba(163,45,45,0.15)', color: '#f09595', icon: 'ti-shield' },
  gestor: { label: 'Gestor', background: 'rgba(55,138,221,0.15)', color: '#85b7eb', icon: 'ti-tool' },
  lector: { label: 'Lector', background: 'rgba(175,169,236,0.15)', color: '#afa9ec', icon: 'ti-eye' },
  andacor: { label: 'Andacor', background: 'rgba(239,159,39,0.15)', color: '#fac775', icon: 'ti-search' },
  socio: { label: 'Socio', background: 'rgba(29,158,117,0.15)', color: '#5dcaa5', icon: 'ti-user' },
}

const iniciales = (nombre) => {
  const partes = (nombre || '').trim().split(/\s+/)
  if (partes.length === 0 || !partes[0]) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[1][0]).toUpperCase()
}

const NAV = [
  { section: 'Principal' },
  { path: '/dashboard', icon: 'ti-dashboard', label: 'Dashboard' },
  { section: 'Gestión' },
  { path: '/socios', icon: 'ti-users', label: 'Socios' },
  { path: '/beneficiarios', icon: 'ti-heart', label: 'Beneficiarios' },
  { path: '/cuotas', icon: 'ti-receipt', label: 'Cuotas' },
  { path: '/socios-activos', icon: 'ti-list-check', label: 'Socios activos' },
  { section: 'Finanzas' },
  { path: '/cartola', icon: 'ti-file-spreadsheet', label: 'Cartola Bancaria' },
  { path: '/cheques', icon: 'ti-writing', label: 'Cheques recibidos' },
  { path: '/chequera', icon: 'ti-book', label: 'Control chequera' },
  { path: '/cuentas-por-pagar', icon: 'ti-file-invoice', label: 'Cuentas por pagar' },
  { path: '/otros-ingresos', icon: 'ti-coin', label: 'Otros ingresos' },
  { path: '/cobranza', icon: 'ti-mail-forward', label: 'Cobranza' },
  { section: 'Clases de esquí' },
  { path: '/clases/solicitar', icon: 'ti-ski-jumping', label: 'Solicitar clase' },
  { path: '/clases/gestion', icon: 'ti-clipboard-list', label: 'Gestionar clases' },
  { path: '/clases/catalogos', icon: 'ti-list-details', label: 'Gestión Escuela' },
  { path: '/clases/config', icon: 'ti-adjustments', label: 'Configuración clases' },
  { path: '/clases/reporte', icon: 'ti-report-money', label: 'Reporte mensual' },
  { section: 'Configuración' },
  { path: '/bancos', icon: 'ti-building-bank', label: 'Bancos y config.' },
  { path: '/reporteria', icon: 'ti-chart-bar', label: 'Reportería' },
  { path: '/reporte-financiero', icon: 'ti-report-money', label: 'Reporte financiero' },
  { path: '/usuarios', icon: 'ti-shield-lock', label: 'Usuarios' },
]

const PAGE_TITLES = {
  '/dashboard': 'Dashboard',
  '/socios': 'Registro de Socios',
  '/beneficiarios': 'Beneficiarios',
  '/socios-activos': 'Socios activos',
  '/cuentas-por-pagar': 'Cuentas por pagar',
  '/otros-ingresos': 'Otros ingresos',
  '/cartola': 'Cartola Bancaria',
  '/cuotas': 'Cuotas Anuales',
  '/cheques': 'Cheques recibidos',
  '/chequera': 'Control Chequera',
  '/cobranza': 'Cobranza',
  '/bancos': 'Mantenedor de Bancos',
  '/reporteria': 'Reportería',
  '/reporte-financiero': 'Reporte financiero',
  '/usuarios': 'Usuarios',
  '/clases/solicitar': 'Solicitar clase de esquí',
  '/clases/gestion': 'Gestión de clases',
  '/clases/catalogos': 'Clases de esquí — Gestión Escuela',
  '/clases/config': 'Clases de esquí — Configuración',
  '/clases/reporte': 'Clases de esquí — Reporte mensual',
}

export default function Layout({ children }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user, permisos, tieneAcceso, puedeEditar, logout, primeraRutaPermitida } = useAuth()

  const [esMovil, setEsMovil] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const [menuAbierto, setMenuAbierto] = useState(() => {
    if (typeof window === 'undefined') return true
    if (window.innerWidth < 768) return false
    const saved = localStorage.getItem('teski_menu_abierto')
    return saved === null ? true : saved === 'true'
  })

  useEffect(() => {
    const onResize = () => {
      const mob = window.innerWidth < 768
      setEsMovil(prev => {
        if (prev !== mob) {
          if (mob) setMenuAbierto(false)
          else {
            const saved = localStorage.getItem('teski_menu_abierto')
            setMenuAbierto(saved === null ? true : saved === 'true')
          }
        }
        return mob
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 60000)
    return () => clearInterval(t)
  }, [])

  // Early returns DESPUÉS de todos los hooks (regla de hooks).
  const seccionActual = PATH_SECCION[pathname]
  const permisosListos = user?.rol === 'admin' || Object.keys(permisos).length > 0
  if (user && permisosListos && seccionActual && !tieneAcceso(seccionActual)) {
    const destino = primeraRutaPermitida()
    if (destino && destino !== pathname) return <Navigate to={destino} replace />
  }

  const handleLogout = () => { logout(); window.location.href = '/' }

  const toggleMenu = () => {
    const nuevo = !menuAbierto
    setMenuAbierto(nuevo)
    if (!esMovil) localStorage.setItem('teski_menu_abierto', String(nuevo))
  }

  const irA = (path) => {
    navigate(path)
    if (esMovil) setMenuAbierto(false)
  }

  const restanteMs = user ? tiempoRestanteSesion(user) : null
  const formatRestante = (ms) => {
    if (ms == null) return ''
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    return `${h}h ${m}m`
  }

  const title = Object.entries(PAGE_TITLES).find(([k]) => pathname.startsWith(k))?.[1] || 'Teski Club'

  // Filtrar NAV según permisos y eliminar headers de sección huérfanos
  const navConPermisos = NAV.filter(item => {
    if (item.section) return true
    const seccion = PATH_SECCION[item.path]
    if (!seccion) return true
    return tieneAcceso(seccion)
  })
  const navFiltrado = navConPermisos.filter((item, i, arr) => {
    if (!item.section) return true
    const next = arr[i + 1]
    return next && !next.section
  })

  const rolMeta = ROL_META[user?.rol] || ROL_META.admin

  const mostrarFull = esMovil ? menuAbierto : menuAbierto
  const labelsVisibles = esMovil ? menuAbierto : menuAbierto
  const anchoSidebar = esMovil ? 240 : (menuAbierto ? 220 : 60)
  const marginMain = esMovil ? 0 : (menuAbierto ? 220 : 60)

  return (
    <div style={{ display:'flex', minHeight:'100vh' }}>
      {/* Overlay para móvil */}
      {esMovil && menuAbierto && (
        <div onClick={() => setMenuAbierto(false)} style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 90,
        }} />
      )}

      {/* Sidebar */}
      <aside style={{
        width: anchoSidebar,
        background:'#0d1e38',
        borderRight:'0.5px solid var(--border)',
        display:'flex', flexDirection:'column',
        position:'fixed', top:0, left:0, bottom:0,
        zIndex: esMovil ? 100 : 10,
        transform: esMovil && !menuAbierto ? 'translateX(-100%)' : 'translateX(0)',
        transition: 'transform 0.3s ease, width 0.3s ease',
        overflowX: 'hidden',
      }}>
        <div style={{ padding: labelsVisibles ? '1.25rem 1rem 1rem' : '1rem 0.5rem', borderBottom:'0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: labelsVisibles ? 'flex-start' : 'center' }}>
          {labelsVisibles ? (
            <div style={{ flex: 1 }}>
              <img src={logo} alt="Teski Club" style={{ width:'100%', maxWidth:170, display:'block', marginBottom:8, filter:'brightness(1.1)' }} />
              <div style={{ fontSize:11, color:'var(--text-dim)', letterSpacing:2, fontFamily:'sans-serif', textTransform:'uppercase' }}>Sistema de Socios</div>
            </div>
          ) : (
            <i className="ti ti-mountain" style={{ fontSize: 24, color: 'var(--gold)' }} title="Teski Club"></i>
          )}
        </div>

        <nav style={{ flex:1, padding:'0.75rem 0', overflowY:'auto', overflowX: 'hidden' }}>
          {navFiltrado.map((item, i) => {
            if (item.section) {
              if (!labelsVisibles) return null
              return (
                <div key={i} style={{ padding:'0.4rem 1rem 0.2rem', fontSize:10, color:'var(--text-dim)', letterSpacing:2, textTransform:'uppercase', fontFamily:'sans-serif', marginTop: i > 0 ? '0.4rem' : 0 }}>
                  {item.section}
                </div>
              )
            }
            const active = pathname.startsWith(item.path)
            return (
              <div key={item.path} onClick={() => irA(item.path)} title={!labelsVisibles ? item.label : undefined} style={{
                display:'flex', alignItems:'center', gap:10,
                padding: labelsVisibles ? '0.55rem 1.25rem' : '0.65rem 0',
                justifyContent: labelsVisibles ? 'flex-start' : 'center',
                fontSize:13, fontFamily:'sans-serif',
                color: active ? 'var(--gold)' : 'var(--text-muted)',
                cursor:'pointer',
                borderLeft:`2px solid ${active ? 'var(--gold)' : 'transparent'}`,
                background: active ? 'rgba(201,168,76,0.08)' : 'transparent',
                transition:'all 0.15s',
              }}>
                <i className={`ti ${item.icon}`} style={{ fontSize:16 }}></i>
                {labelsVisibles && <span>{item.label}</span>}
              </div>
            )
          })}
        </nav>

        <div style={{ padding: labelsVisibles ? '1rem 1.25rem' : '0.75rem 0.5rem', borderTop:'0.5px solid var(--border)' }}>
          {user && labelsVisibles && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: rolMeta.background, color: rolMeta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 'bold', flexShrink: 0 }}>
                  {iniciales(user.nombre)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#c8d0dc', fontFamily: 'sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.nombre}</div>
                  <div style={{ fontSize: 10, color: rolMeta.color, fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <i className={`ti ${rolMeta.icon}`} style={{ fontSize: 11 }}></i> {rolMeta.label}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 11, color:'var(--text-dim)', fontFamily:'sans-serif', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email || user?.username || ''}</div>
              {restanteMs != null && (
                <div style={{ fontSize: 10, color:'var(--text-dim)', fontFamily:'sans-serif', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className="ti ti-clock" style={{ fontSize: 11 }}></i> Sesión: {formatRestante(restanteMs)}
                </div>
              )}
              <button className="btn btn-sm btn-danger" onClick={handleLogout} style={{ width:'100%', justifyContent:'center' }}>
                <i className="ti ti-logout"></i> Cerrar sesión
              </button>
            </>
          )}
          {user && !labelsVisibles && (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }} title={`${user.nombre} · ${rolMeta.label}`}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: rolMeta.background, color: rolMeta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 'bold' }}>
                  {iniciales(user.nombre)}
                </div>
              </div>
              <button className="btn btn-sm btn-danger" onClick={handleLogout} style={{ width:'100%', justifyContent:'center', padding: '6px 0' }} title="Cerrar sesión">
                <i className="ti ti-logout"></i>
              </button>
            </>
          )}
        </div>
      </aside>

      <div style={{ marginLeft: marginMain, flex:1, display:'flex', flexDirection:'column', transition: 'margin-left 0.3s ease', minWidth: 0 }}>
        <div style={{ background:'#0d1e38', borderBottom:'0.5px solid var(--border)', padding:'0 1rem 0 0.5rem', height:56, display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:5, gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button onClick={toggleMenu} style={{
              background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 22, padding: '4px 8px',
              display: 'flex', alignItems: 'center',
            }} title={menuAbierto ? 'Colapsar menú' : 'Abrir menú'}>
              <i className={`ti ${menuAbierto ? 'ti-x' : 'ti-menu-2'}`}></i>
            </button>
            <div style={{ fontSize:16, color:'var(--gold-light)', letterSpacing:0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          </div>
          {puedeEditar('socios') && (
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/socios')} style={{ flexShrink: 0 }}>
              <i className="ti ti-user-plus"></i> {esMovil ? '' : 'Nuevo socio'}
            </button>
          )}
        </div>
        <div style={{ padding: esMovil ? '1rem' : '2rem', flex:1 }}>
          {children}
        </div>
      </div>
    </div>
  )
}
