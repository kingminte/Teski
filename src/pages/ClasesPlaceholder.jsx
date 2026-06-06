import { useLocation } from 'react-router-dom'

const INFO = {
  '/clases/solicitar': {
    icon: 'ti-ski-jumping', titulo: 'Solicitar clase',
    detalle: 'Acá los socios van a poder solicitar clases para los días disponibles, eligiendo disciplina y participantes.',
    fase: 'Fase 2',
  },
  '/clases/gestion': {
    icon: 'ti-clipboard-list', titulo: 'Gestionar clases',
    detalle: 'Acá Andacor va a recibir las solicitudes, armar los grupos con horario y profesor, y marcar asistencia.',
    fase: 'Fase 2',
  },
  '/clases/reporte': {
    icon: 'ti-report-money', titulo: 'Reporte mensual',
    detalle: 'Acá el admin va a generar el reporte de horas-profesor del mes para pagar a Andacor.',
    fase: 'Fase 3',
  },
}

export default function ClasesPlaceholder() {
  const { pathname } = useLocation()
  const info = INFO[pathname] || { icon: 'ti-tools', titulo: 'Clases de esquí', detalle: 'Sección en construcción.', fase: 'Próximamente' }

  return (
    <div className="card">
      <div style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <i className={`ti ${info.icon}`} style={{ fontSize: 48, color: 'var(--gold-dim)', display: 'block', marginBottom: 16 }}></i>
        <div style={{ fontSize: 18, color: 'var(--gold-light)', marginBottom: 8 }}>{info.titulo}</div>
        <div style={{ fontSize: 13, fontFamily: 'sans-serif', maxWidth: 460, margin: '0 auto 16px' }}>{info.detalle}</div>
        <span className="badge badge-pending"><i className="ti ti-tools" style={{ fontSize: 11, marginRight: 4 }}></i> En construcción — {info.fase}</span>
      </div>
    </div>
  )
}
