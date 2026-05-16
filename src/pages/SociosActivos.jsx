import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/useToast.jsx'
import { useAuth } from '../lib/useAuth'

const RELACIONES = {
  conyuge: 'Cónyuge',
  hijo: 'Hijo/a',
  padre: 'Padre',
  madre: 'Madre',
  hermano: 'Hermano/a',
  otro: 'Otro',
}

const ordenBeneficiarios = (a, b) => {
  const prioridad = { conyuge: 0, hijo: 1, padre: 2, madre: 3, hermano: 4, otro: 5 }
  return (prioridad[a.relacion] ?? 9) - (prioridad[b.relacion] ?? 9)
}

const relacionStyle = (rel) => {
  if (rel === 'conyuge') return { background: 'rgba(55,138,221,0.15)', color: '#85b7eb', border: '0.5px solid rgba(55,138,221,0.3)' }
  if (rel === 'hijo') return { background: 'rgba(239,159,39,0.15)', color: '#fac775', border: '0.5px solid rgba(239,159,39,0.3)' }
  return { background: 'rgba(175,169,236,0.15)', color: '#afa9ec', border: '0.5px solid rgba(175,169,236,0.3)' }
}

export default function SociosActivos() {
  const { showToast, ToastComponent } = useToast()
  const { user } = useAuth()
  const esSocio = user?.rol === 'socio'
  const miSocioId = user?.socio_id
  const [socios, setSocios] = useState([])
  const [beneficiarios, setBeneficiarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [exportando, setExportando] = useState(false)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    let sQ = supabase.from('socios').select('id,numero_socio,nombre,apellido,rut,email').eq('estado', 'activo').order('numero_socio')
    let bQ = supabase.from('beneficiarios').select('id,socio_id,nombre,apellido,rut,relacion').order('socio_id')
    if (esSocio && miSocioId) {
      sQ = sQ.eq('id', miSocioId)
      bQ = bQ.eq('socio_id', miSocioId)
    }
    const [sRes, bRes] = await Promise.all([sQ, bQ])
    setSocios(sRes.data || [])
    setBeneficiarios(bRes.data || [])
    setLoading(false)
  }

  const beneficiariosDe = (socioId) => beneficiarios.filter(b => b.socio_id === socioId && b.estado !== 'inactivo').sort(ordenBeneficiarios)

  const sociosFiltrados = (() => {
    const q = busqueda.toLowerCase().trim()
    if (!q) return socios
    return socios.filter(s => {
      const matchSocio = `${s.nombre} ${s.apellido} ${s.rut || ''} ${s.numero_socio}`.toLowerCase().includes(q)
      if (matchSocio) return true
      return beneficiariosDe(s.id).some(b => `${b.nombre} ${b.apellido} ${b.rut || ''}`.toLowerCase().includes(q))
    })
  })()

  const totalBeneficiarios = socios.reduce((t, s) => t + beneficiariosDe(s.id).length, 0)
  const sinEmail = socios.filter(s => !s.email).length

  const handleExportar = async () => {
    if (socios.length === 0) { showToast('No hay datos', 'error'); return }
    setExportando(true)
    try {
      const XLSX = await import('xlsx')
      const rows = []
      sociosFiltrados.forEach(s => {
        rows.push({
          'N° Socio': s.numero_socio,
          'Nombre socio': s.nombre || '',
          'Apellido socio': s.apellido || '',
          'RUT socio': s.rut || '',
          'Email socio': s.email || '',
          'Relación': '',
          'Nombre beneficiario': '',
          'Apellido beneficiario': '',
          'RUT beneficiario': '',
        })
        beneficiariosDe(s.id).forEach(b => {
          rows.push({
            'N° Socio': s.numero_socio,
            'Nombre socio': s.nombre || '',
            'Apellido socio': s.apellido || '',
            'RUT socio': s.rut || '',
            'Email socio': s.email || '',
            'Relación': RELACIONES[b.relacion] || b.relacion || '',
            'Nombre beneficiario': b.nombre || '',
            'Apellido beneficiario': b.apellido || '',
            'RUT beneficiario': b.rut || '',
          })
        })
      })
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [{ wch: 10 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 14 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Socios activos')
      const hoy = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `Socios_activos_${hoy}.xlsx`)
      showToast('Excel descargado')
    } catch (e) {
      showToast('Error al exportar', 'error')
    }
    setExportando(false)
  }

  return (
    <div>
      {ToastComponent}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: '1.5rem' }}>
        {[
          { label: 'Socios activos', value: socios.length, color: '#5dcaa5' },
          { label: 'Total beneficiarios', value: totalBeneficiarios, color: '#85b7eb' },
          { label: 'Sin email', value: sinEmail, color: '#fac775' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><i className="ti ti-list-check"></i> Socios activos ({sociosFiltrados.length})</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="search-box">
              <i className="ti ti-search"></i>
              <input placeholder="Buscar nombre, RUT o N° socio…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            </div>
            {!esSocio && (
              <button className="btn btn-sm" style={{ color: '#5dcaa5', borderColor: 'rgba(29,158,117,0.4)' }} onClick={handleExportar} disabled={exportando}>
                {exportando ? <><i className="ti ti-loader"></i> Exportando…</> : <><i className="ti ti-file-spreadsheet"></i> Descargar Excel</>}
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="empty-state"><i className="ti ti-loader"></i>Cargando…</div>
        ) : sociosFiltrados.length === 0 ? (
          <div className="empty-state"><i className="ti ti-users"></i>{socios.length === 0 ? 'No hay socios activos' : 'Sin resultados'}</div>
        ) : (
          <table>
            <thead>
              <tr><th>N° Socio</th><th>Nombre</th><th>RUT</th><th>Email</th><th>Relación</th></tr>
            </thead>
            <tbody>
              {sociosFiltrados.map(s => {
                const bens = beneficiariosDe(s.id)
                return (
                  <React.Fragment key={s.id}>
                    <tr style={{ background: 'rgba(10,22,40,0.4)' }}>
                      <td style={{ fontWeight: 'bold' }}><span className="chip">{s.numero_socio}</span></td>
                      <td style={{ fontWeight: 'bold', textTransform: 'uppercase' }}>{s.nombre} {s.apellido}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.rut || '—'}</td>
                      <td style={{ color: s.email ? 'var(--text-muted)' : '#fac775', fontSize: 12 }}>{s.email || 'Sin email'}</td>
                      <td></td>
                    </tr>
                    {bens.map(b => (
                      <tr key={b.id}>
                        <td></td>
                        <td style={{ paddingLeft: 28, color: 'var(--text-muted)' }}>{b.nombre} {b.apellido}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{b.rut || '—'}</td>
                        <td></td>
                        <td>
                          <span className="badge" style={relacionStyle(b.relacion)}>{RELACIONES[b.relacion] || b.relacion}</span>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
