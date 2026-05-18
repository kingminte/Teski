import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, loadUserFromStorage, isSesionExpirada } from './lib/useAuth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Socios from './pages/Socios'
import Beneficiarios from './pages/Beneficiarios'
import Cartola from './pages/Cartola'
import Cuotas from './pages/Cuotas'
import Cheques from './pages/Cheques'
import Chequera from './pages/Chequera'
import Incorporaciones from './pages/Incorporaciones'
import Bancos from './pages/Bancos'
import Reporteria from './pages/Reporteria'
import Cobranza from './pages/Cobranza'
import CuentasPorPagar from './pages/CuentasPorPagar'
import OtrosIngresos from './pages/OtrosIngresos'
import Usuarios from './pages/Usuarios'
import SociosActivos from './pages/SociosActivos'
import CambiarClave from './pages/CambiarClave'

export default function App() {
  const [user, setUser] = useState(loadUserFromStorage)

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'teski_user') setUser(loadUserFromStorage())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      const u = loadUserFromStorage()
      if (!u && user) {
        // Sesión expirada — limpiar y redirigir
        localStorage.removeItem('teski_user')
        setUser(null)
        if (window.location.pathname !== '/' && !window.location.search.includes('expired')) {
          window.location.href = '/?expired=true'
        }
      }
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [user])

  if (!user) {
    return (
      <AuthProvider user={null} onUserChange={setUser}>
        <Login />
      </AuthProvider>
    )
  }

  if (user.debe_cambiar_clave) {
    return (
      <AuthProvider user={user} onUserChange={setUser}>
        <CambiarClave />
      </AuthProvider>
    )
  }

  return (
    <AuthProvider user={user} onUserChange={setUser}>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/socios" element={<Socios />} />
          <Route path="/beneficiarios" element={<Beneficiarios />} />
          <Route path="/beneficiarios/:socioId" element={<Beneficiarios />} />
          <Route path="/socios-activos" element={<SociosActivos />} />
          <Route path="/cuentas-por-pagar" element={<CuentasPorPagar />} />
          <Route path="/otros-ingresos" element={<OtrosIngresos />} />
          <Route path="/cartola" element={<Cartola />} />
          <Route path="/cuotas" element={<Cuotas />} />
          <Route path="/cobranza" element={<Cobranza />} />
          <Route path="/cheques" element={<Cheques />} />
          <Route path="/chequera" element={<Chequera />} />
          <Route path="/incorporaciones" element={<Incorporaciones />} />
          <Route path="/bancos" element={<Bancos />} />
          <Route path="/reporteria" element={<Reporteria />} />
          <Route path="/usuarios" element={<Usuarios />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Layout>
    </AuthProvider>
  )
}
