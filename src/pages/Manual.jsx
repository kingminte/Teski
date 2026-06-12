import { useState } from 'react'
import { useAuth } from '../lib/useAuth'
import ManualSocio from '../components/ManualSocio'
import ManualAndacor from '../components/ManualAndacor'

export default function Manual() {
  const { user } = useAuth()
  const rol = user?.rol
  const [tab, setTab] = useState('socio')

  // Socio → su manual. Andacor → el suyo. Admin/gestor/lector → ambos con tabs.
  const soloSocio = rol === 'socio'
  const soloAndacor = rol === 'andacor'

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      {soloSocio ? (
        <ManualSocio />
      ) : soloAndacor ? (
        <ManualAndacor />
      ) : (
        <>
          <div className="no-print" style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', marginBottom: '1.25rem' }}>
            {[{ id: 'socio', icon: 'ti-user', label: 'Manual del socio' }, { id: 'andacor', icon: 'ti-search', label: 'Manual de Andacor' }].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: '8px 20px', fontSize: 13, border: 'none', background: 'transparent',
                color: tab === t.id ? 'var(--gold)' : 'var(--text-muted)',
                borderBottom: `2px solid ${tab === t.id ? 'var(--gold)' : 'transparent'}`,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: 'sans-serif', fontWeight: tab === t.id ? 'bold' : 'normal',
              }}>
                <i className={`ti ${t.icon}`}></i> {t.label}
              </button>
            ))}
          </div>
          {tab === 'socio' ? <ManualSocio /> : <ManualAndacor />}
        </>
      )}
    </div>
  )
}
