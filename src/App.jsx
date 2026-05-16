import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { AuthProvider } from './lib/useAuth'
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
import Usuarios from './pages/Usuarios'
import SociosActivos from './pages/SociosActivos'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--gold)', fontFamily:'sans-serif' }}>
      <i className="ti ti-loader" style={{ fontSize:32, marginRight:12 }}></i>
      Cargando...
    </div>
  )

  if (!session) return <Login />

  return (
    <AuthProvider session={session}>
    <Layout session={session}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/socios" element={<Socios />} />
        <Route path="/beneficiarios" element={<Beneficiarios />} />
        <Route path="/beneficiarios/:socioId" element={<Beneficiarios />} />
        <Route path="/socios-activos" element={<SociosActivos />} />
        <Route path="/cuentas-por-pagar" element={<CuentasPorPagar />} />
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
