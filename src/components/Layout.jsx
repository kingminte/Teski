import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/useAuth'
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
  '/cobranza': 'cobranza',
  '/bancos': 'configuracion',
  '/reporteria': 'reporteria',
  '/usuarios': 'usuarios',
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
  { path: '/cobranza', icon: 'ti-mail-forward', label: 'Cobranza' },
  { section: 'Configuración' },
  { path: '/bancos', icon: 'ti-building-bank', label: 'Bancos y config.' },
  { path: '/reporteria', icon: 'ti-chart-bar', label: 'Reportería' },
  { path: '/usuarios', icon: 'ti-shield-lock', label: 'Usuarios' },
]

const PAGE_TITLES = {
  '/dashboard': 'Dashboard',
  '/socios': 'Registro de Socios',
  '/beneficiarios': 'Beneficiarios',
  '/socios-activos': 'Socios activos',
  '/cuentas-por-pagar': 'Cuentas por pagar',
  '/cartola': 'Cartola Bancaria',
  '/cuotas': 'Cuotas Anuales',
  '/cheques': 'Cheques recibidos',
  '/chequera': 'Control Chequera',
  '/cobranza': 'Cobranza',
  '/bancos': 'Mantenedor de Bancos',
  '/reporteria': 'Reportería',
  '/usuarios': 'Usuarios',
}

export default function Layout({ children, session }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user, tieneAcceso } = useAuth()

  const handleLogout = async () => { await supabase.auth.signOut() }

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

  return (
    <div style={{ display:'flex', minHeight:'100vh' }}>
      <div style={{ width:220, background:'#0d1e38', borderRight:'0.5px solid var(--border)', display:'flex', flexDirection:'column', position:'fixed', top:0, left:0, bottom:0, zIndex:10 }}>
        <div style={{ padding:'1.25rem 1rem 1rem', borderBottom:'0.5px solid var(--border)' }}>
          <img src={logo} alt="Teski Club" style={{ width:'100%', maxWidth:170, display:'block', marginBottom:8, filter:'brightness(1.1)' }} />
          <div style={{ fontSize:11, color:'var(--text-dim)', letterSpacing:2, fontFamily:'sans-serif', textTransform:'uppercase' }}>Sistema de Socios</div>
        </div>

        <nav style={{ flex:1, padding:'0.75rem 0', overflowY:'auto' }}>
          {navFiltrado.map((item, i) => {
            if (item.section) return (
              <div key={i} style={{ padding:'0.4rem 1rem 0.2rem', fontSize:10, color:'var(--text-dim)', letterSpacing:2, textTransform:'uppercase', fontFamily:'sans-serif', marginTop: i > 0 ? '0.4rem' : 0 }}>
                {item.section}
              </div>
            )
            const active = pathname.startsWith(item.path)
            return (
              <div key={item.path} onClick={() => navigate(item.path)} style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'0.55rem 1.25rem', fontSize:13, fontFamily:'sans-serif',
                color: active ? 'var(--gold)' : 'var(--text-muted)',
                cursor:'pointer',
                borderLeft:`2px solid ${active ? 'var(--gold)' : 'transparent'}`,
                background: active ? 'rgba(201,168,76,0.08)' : 'transparent',
                transition:'all 0.15s',
              }}>
                <i className={`ti ${item.icon}`} style={{ fontSize:16 }}></i>
                {item.label}
              </div>
            )
          })}
        </nav>

        <div style={{ padding:'1rem 1.25rem', borderTop:'0.5px solid var(--border)' }}>
          {user && (
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
          )}
          <div style={{ fontSize: 11, color:'var(--text-dim)', fontFamily:'sans-serif', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user.email}</div>
          <button className="btn btn-sm btn-danger" onClick={handleLogout} style={{ width:'100%', justifyContent:'center' }}>
            <i className="ti ti-logout"></i> Cerrar sesión
          </button>
        </div>
      </div>

      <div style={{ marginLeft:220, flex:1, display:'flex', flexDirection:'column' }}>
        <div style={{ background:'#0d1e38', borderBottom:'0.5px solid var(--border)', padding:'0 2rem', height:56, display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:5 }}>
          <div style={{ fontSize:16, color:'var(--gold-light)', letterSpacing:0.5 }}>{title}</div>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/socios')}>
            <i className="ti ti-user-plus"></i> Nuevo socio
          </button>
        </div>
        <div style={{ padding:'2rem', flex:1 }}>
          {children}
        </div>
      </div>
    </div>
  )
}
