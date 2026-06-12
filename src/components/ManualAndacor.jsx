// Manual de Andacor. Tono cercano ("tú"). Describe los flujos reales del
// sistema. Primitivas de presentación locales a este manual.

const Seccion = ({ id, icon, titulo, children }) => (
  <section id={id} className="manual-seccion" style={{ marginBottom: 26, scrollMarginTop: 70 }}>
    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, color: 'var(--gold-light)', background: 'rgba(201,168,76,0.08)', borderLeft: '3px solid var(--gold)', borderRadius: 6, padding: '8px 12px', margin: '0 0 12px' }}>
      <i className={`ti ${icon}`} style={{ fontSize: 18 }}></i> {titulo}
    </h3>
    <div style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: 'sans-serif', lineHeight: 1.6 }}>{children}</div>
  </section>
)
const Tip = ({ children }) => (
  <div className="manual-tip" style={{ background: 'rgba(55,138,221,0.12)', borderLeft: '3px solid #85b7eb', color: '#c8d0dc', borderRadius: 6, padding: '8px 12px', margin: '10px 0', fontSize: 13.5 }}>
    💡 <strong style={{ color: '#85b7eb' }}>Tip:</strong> {children}
  </div>
)
const Atencion = ({ children }) => (
  <div className="manual-atencion" style={{ background: 'rgba(239,159,39,0.1)', borderLeft: '3px solid #BA7517', color: '#c8d0dc', borderRadius: 6, padding: '8px 12px', margin: '10px 0', fontSize: 13.5 }}>
    ⚠ <strong style={{ color: '#fac775' }}>Atención:</strong> {children}
  </div>
)
const Pasos = ({ children }) => <ol style={{ margin: '8px 0', paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 5 }}>{children}</ol>

const TOC = ({ items }) => (
  <div className="manual-toc" style={{ background: 'var(--navy-card)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 24 }}>
    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'sans-serif', marginBottom: 8 }}>Contenido</div>
    <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 4 }}>
      {items.map(it => (
        <li key={it.id} style={{ fontSize: 13.5, fontFamily: 'sans-serif' }}>
          <a href={`#${it.id}`} style={{ color: '#85b7eb', textDecoration: 'none' }}>{it.label}</a>
        </li>
      ))}
    </ol>
  </div>
)

const SECCIONES = [
  { id: 'inicio-sesion', label: 'Iniciar sesión' },
  { id: 'disponibilidad', label: 'Publicar disponibilidad' },
  { id: 'catalogos', label: 'Administrar catálogos' },
  { id: 'agrupar', label: 'Agrupar solicitudes' },
  { id: 'asistencia', label: 'Marcar asistencia' },
  { id: 'casos', label: 'Casos especiales' },
  { id: 'reporte', label: 'Reporte mensual' },
  { id: 'credencial', label: 'Validar credencial' },
  { id: 'contacto', label: 'Contacto' },
]

export default function ManualAndacor() {
  return (
    <div className="manual">
      <h2 style={{ margin: '0 0 4px', color: 'var(--gold-light)', fontSize: 22 }}>Manual de Andacor</h2>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginBottom: 20 }}>
        Guía para gestionar las clases de esquí. Para guardar en PDF: usa <strong>Imprimir → Guardar como PDF</strong> de tu navegador.
      </div>

      <TOC items={SECCIONES} />

      <Seccion id="inicio-sesion" icon="ti-login" titulo="1. Cómo iniciar sesión">
        <p>Escribe tu usuario y contraseña en la pantalla de inicio. La primera vez, el sistema te pide cambiar la contraseña por una nueva tuya.</p>
        <Tip>Tu sesión queda activa por 8 horas; después el sistema te pide volver a entrar.</Tip>
      </Seccion>

      <Seccion id="disponibilidad" icon="ti-calendar-event" titulo="2. Publicar disponibilidad de fechas">
        <p>En el menú, entra a <strong>Gestión Escuela</strong> y abre la pestaña <strong>Disponibilidad</strong>. Toca <strong>Agregar fecha</strong>, elige el día (y unas notas si quieres) y guarda.</p>
        <p>Las fechas que publiques son las únicas que los socios pueden elegir al solicitar una clase. Si no hay fechas, los socios ven el aviso de que todavía no publicaste disponibilidad.</p>
      </Seccion>

      <Seccion id="catalogos" icon="ti-list-details" titulo="3. Administrar catálogos">
        <p>En <strong>Gestión Escuela</strong> tienes dos catálogos administrables:</p>
        <ul style={{ margin: '6px 0', paddingLeft: 22 }}>
          <li><strong>Profesores</strong>: agregar, editar, activar/desactivar y eliminar. Los inactivos no aparecen al asignar profesor a un grupo.</li>
          <li><strong>Niveles</strong>: agregar/editar, ordenar (campo orden) y activar/desactivar. Se usan para esquí y snowboard.</li>
        </ul>
        <Atencion>La <strong>tarifa por hora-profesor</strong> y las reglas de pago las define el administrador del club; no se gestionan ni se ven desde tu rol.</Atencion>
      </Seccion>

      <Seccion id="agrupar" icon="ti-clipboard-list" titulo="4. Agrupar solicitudes en clases">
        <p>En el menú, entra a <strong>Gestionar clases</strong> y elige la fecha arriba. A la izquierda ves las <strong>solicitudes pendientes</strong>; a la derecha, las <strong>clases programadas</strong>.</p>
        <Pasos>
          <li>En una solicitud pendiente, toca <strong>+ Agrupar</strong>.</li>
          <li>Elige <strong>Crear nuevo grupo</strong> (define hora de inicio, hora de fin, profesor y un comentario opcional) o <strong>agregar a un grupo existente</strong> del mismo tipo.</li>
          <li>Al confirmar, la solicitud pasa a <strong>Agendada</strong> y aparece en la clase de la derecha.</li>
        </Pasos>
        <Atencion>No puedes asignar al mismo profesor a dos clases que se solapan en horario el mismo día. Si lo intentas, el sistema te avisa con el horario en conflicto. Clases contiguas (por ejemplo 10–11 y 11–12) sí están permitidas.</Atencion>
      </Seccion>

      <Seccion id="asistencia" icon="ti-checkbox" titulo="5. Marcar asistencia y realizada / no realizada">
        <p>Cuando termina la clase, en la tarjeta del grupo (en <strong>Gestionar clases</strong>) toca <strong>Marcar realizada</strong>. Se abre la lista de participantes con todos marcados como “Asistió” por defecto.</p>
        <Pasos>
          <li>Destilda a quienes no asistieron.</li>
          <li>Mira el resumen (cuántos asistieron y las horas-profesor que se contarán).</li>
          <li>Confirma.</li>
        </Pasos>
        <p>Si asistió al menos uno, la clase queda <strong>Realizada</strong>. Si no asistió nadie, queda <strong>No realizada</strong> y no se cuenta como hora-profesor.</p>
      </Seccion>

      <Seccion id="casos" icon="ti-alert-triangle" titulo="6. Casos especiales">
        <p><strong>Desmarcar una clase:</strong> si te equivocaste, en una clase ya marcada toca <strong>Desmarcar realizada</strong>. El mismo día de la clase puedes hacerlo tú; para días anteriores, solo el administrador.</p>
        <p><strong>Cancelaciones del socio:</strong> si un socio cancela, su solicitud deja de contar en el grupo. Si un grupo queda sin participantes, aparece marcado como “Grupo sin participantes” y puedes eliminarlo.</p>
        <p><strong>Editar o eliminar un grupo:</strong> puedes cambiar hora/profesor/comentario, o eliminarlo. Al eliminar un grupo, sus solicitudes vuelven a <strong>pendientes</strong> para reagruparlas.</p>
      </Seccion>

      <Seccion id="reporte" icon="ti-report-money" titulo="7. Reporte mensual">
        <p>En el menú, entra a <strong>Reporte mensual</strong>. Ves el resumen del <strong>corte actual</strong> (el período de clases abierto):</p>
        <ul style={{ margin: '6px 0', paddingLeft: 22 }}>
          <li>Total de <strong>horas-profesor</strong> del corte.</li>
          <li><strong>Clases realizadas</strong> y total de <strong>asistencias</strong>.</li>
          <li>Detalle <strong>por disciplina</strong> (esquí / snowboard): clases, horas y asistencias.</li>
          <li>Detalle <strong>por profesor</strong>: nombre y horas dictadas.</li>
          <li>Tabla con <strong>todas las clases</strong> del corte: fecha, horario, tipo, profesor y asistencias/total.</li>
        </ul>
        <Atencion>No ves los <strong>montos</strong> (lo que se paga): esa parte es de la tesorería. Tampoco puedes <strong>cerrar el corte</strong> ni navegar cortes anteriores; solo ves el corte abierto actual. Si no hay ninguno abierto, verás “No hay corte abierto actualmente”.</Atencion>
        <Tip>El reporte muestra las clases de <strong>todos</strong> los profesores del corte, no solo las tuyas.</Tip>
      </Seccion>

      <Seccion id="credencial" icon="ti-id-badge" titulo="8. Validar la credencial de un socio">
        <p>En el menú, entra a <strong>Credenciales de socios</strong>. Busca al socio por nombre, RUT o número de socio y selecciónalo: ves su credencial con el QR vigente (se renueva cada 60 segundos).</p>
        <p>Antes de la clase, puedes mirar su estado (activo/pendiente/inactivo) o escanear el QR para validarlo.</p>
      </Seccion>

      <Seccion id="contacto" icon="ti-mail" titulo="Contacto">
        <p>¿Dudas o problemas? Escríbele a la tesorería del club:</p>
        <p>
          <strong>Michael King</strong> — Tesorero TeskiClub<br />
          <a href="mailto:kingminte@gmail.com" style={{ color: '#85b7eb' }}>kingminte@gmail.com</a><br />
          +56 9 8428 9489
        </p>
      </Seccion>
    </div>
  )
}
