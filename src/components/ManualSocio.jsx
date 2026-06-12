// Manual del socio. Tono cercano ("tú"). Describe los flujos reales del
// sistema. Las primitivas de presentación (Seccion, Tip, Atencion, TOC) son
// locales a este manual.

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
  { id: 'mi-credencial', label: 'Mi credencial virtual' },
  { id: 'cuotas', label: 'Mis cuotas y pagos' },
  { id: 'beneficios', label: 'Beneficios y convenios' },
  { id: 'comunicaciones', label: 'Comunicaciones' },
  { id: 'solicitar-clase', label: 'Solicitar una clase' },
  { id: 'mis-solicitudes', label: 'Mis solicitudes' },
  { id: 'estados', label: 'Estados de las clases' },
  { id: 'contacto', label: 'Contacto' },
]

export default function ManualSocio() {
  return (
    <div className="manual">
      <h2 style={{ margin: '0 0 4px', color: 'var(--gold-light)', fontSize: 22 }}>Manual del Socio</h2>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', fontFamily: 'sans-serif', marginBottom: 20 }}>
        Guía rápida para usar el sistema del Teski Club. Para guardar en PDF: usa <strong>Imprimir → Guardar como PDF</strong> de tu navegador.
      </div>

      <TOC items={SECCIONES} />

      <Seccion id="inicio-sesion" icon="ti-login" titulo="1. Cómo iniciar sesión por primera vez">
        <p>Para entrar al sistema, escribe tu usuario y contraseña en la pantalla de inicio.</p>
        <p>La primera vez, el sistema te pide cambiar la contraseña por una nueva tuya. Elige una que recuerdes y confírmala. A partir de ahí, entras con esa.</p>
        <Tip>Tu sesión queda activa por 8 horas. Si pasa ese tiempo, el sistema te pide volver a entrar.</Tip>
      </Seccion>

      <Seccion id="mi-credencial" icon="ti-id" titulo="2. Mi credencial virtual">
        <p>En el menú, entra a <strong>Mi credencial</strong>. Vas a ver tu credencial con un código QR que se renueva cada 60 segundos (hay una barra que muestra cuánto falta para que cambie).</p>
        <p>Cuando un tercero (un restaurante con convenio, por ejemplo) escanea el QR, ve una página con tu nombre, tu número de socio y tu estado, válida solo en ese momento.</p>
        <Atencion>El QR cambia solo cada 60 segundos: por eso no sirve sacarle una captura ni reenviar el enlace, porque vence enseguida. Es la protección de la credencial. Si no tienes señal, la tarjeta se muestra sin QR y dice “Sin señal para emitir QR”; reconéctate y vuelve a entrar.</Atencion>
      </Seccion>

      <Seccion id="cuotas" icon="ti-receipt" titulo="3. Mis cuotas y estado de pagos">
        <p>En el menú, entra a <strong>Cuotas</strong>. Arriba ves el <strong>Resumen de deuda consolidada</strong>: una fila por año, con la cuota comprometida, lo pagado y lo pendiente.</p>
        <p>El estado de cada año puede ser:</p>
        <ul style={{ margin: '6px 0', paddingLeft: 22 }}>
          <li><strong style={{ color: '#5dcaa5' }}>Al día</strong>: pagaste todo lo del año.</li>
          <li><strong style={{ color: '#fac775' }}>Parcial</strong>: pagaste una parte.</li>
          <li><strong style={{ color: 'var(--text-dim)' }}>Sin pago</strong>: todavía no hay pagos registrados.</li>
        </ul>
        <p>Solo aparecen los años desde que ingresaste al club. Más abajo, en <strong>Mi historial de pagos</strong>, ves cada pago con su fecha, monto, concepto (Cuota social, Incorporación, etc.) y forma de pago.</p>
        <Tip>Los pagos los registra la tesorería del club. Desde acá tú consultas tu estado; no se paga por la app.</Tip>
      </Seccion>

      <Seccion id="beneficios" icon="ti-gift" titulo="4. Beneficios y convenios">
        <p>En el menú, entra a <strong>Beneficios</strong>. Ves los convenios vigentes en tarjetas, agrupados por categoría (usa los chips de arriba para filtrar por categoría).</p>
        <p>Cada tarjeta muestra el proveedor, el descuento o beneficio, una breve descripción, hasta cuándo está vigente y un contacto.</p>
      </Seccion>

      <Seccion id="comunicaciones" icon="ti-speakerphone" titulo="5. Comunicaciones de la directiva">
        <p>En el menú, entra a <strong>Comunicaciones</strong>. Ves los comunicados publicados por la directiva, del más nuevo al más antiguo. Los chips de arriba filtran por año.</p>
        <p>Cada comunicado tiene un botón <strong>Descargar</strong> que baja el documento adjunto (PDF, Word, etc.). Los publicados hace poco aparecen con una etiqueta “Nuevo”.</p>
      </Seccion>

      <Seccion id="solicitar-clase" icon="ti-ski-jumping" titulo="6. Solicitar una clase de esquí">
        <p>En el menú, entra a <strong>Solicitar clase</strong> y toca <strong>Nueva solicitud</strong>. En la ventana que se abre:</p>
        <Pasos>
          <li>Elige el <strong>día</strong> (solo aparecen las fechas que Andacor habilitó).</li>
          <li>Elige el <strong>tipo</strong>: Esquí o Snowboard.</li>
          <li>Marca los <strong>participantes</strong> (tú y/o tus beneficiarios) y, para cada uno, su <strong>nivel</strong>.</li>
          <li>Toca <strong>Enviar solicitud</strong>.</li>
        </Pasos>
        <p>Se crea una solicitud por cada participante que marcaste.</p>
        <Atencion>Solo los socios <strong>activos</strong> pueden solicitar clases. Si tu cuenta está pendiente, vas a ver un aviso y el botón deshabilitado: contacta a la tesorería para regularizar.</Atencion>
      </Seccion>

      <Seccion id="mis-solicitudes" icon="ti-list-check" titulo="7. Mis solicitudes">
        <p>Debajo del botón, en <strong>Mis solicitudes</strong> ves las que enviaste. Por defecto se muestran las próximas; activa <strong>Ver histórico</strong> para ver todas.</p>
        <p>Cada solicitud muestra el participante, el tipo, la fecha y su estado. Si ya está agendada, ves además la hora, el profesor y con quiénes compartes la clase.</p>
        <p>Para cancelar una solicitud, usa el botón <strong>Cancelar</strong> de la fila y confirma.</p>
        <Atencion>Solo puedes cancelar hasta cierto tiempo antes de la clase. Si ya es demasiado tarde, el botón aparece deshabilitado con el aviso correspondiente.</Atencion>
      </Seccion>

      <Seccion id="estados" icon="ti-info-circle" titulo="8. Estados de las clases">
        <ul style={{ margin: '6px 0', paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li><strong style={{ color: '#fac775' }}>Pendiente</strong> (“Esperando horario”): la enviaste y Andacor todavía no la agrupó.</li>
          <li><strong style={{ color: '#5dcaa5' }}>Agendada</strong>: confirmada, con día, hora y profesor.</li>
          <li><strong style={{ color: '#85b7eb' }}>Realizada</strong>: tomaste la clase.</li>
          <li><strong style={{ color: '#f09595' }}>No realizada</strong>: la clase se registró pero ese participante no asistió (o no asistió nadie del grupo). No se cobra.</li>
          <li><strong style={{ color: 'var(--text-dim)' }}>Cancelada</strong>: la cancelaste tú (se puede cancelar mientras está pendiente o agendada, hasta unas horas antes de la clase).</li>
        </ul>
      </Seccion>

      <Seccion id="contacto" icon="ti-mail" titulo="Contacto">
        <p>¿Dudas o problemas? Escríbele a la tesorería:</p>
        <p>
          <strong>Michael King</strong> — Tesorero TeskiClub<br />
          <a href="mailto:kingminte@gmail.com" style={{ color: '#85b7eb' }}>kingminte@gmail.com</a><br />
          +56 9 8428 9489
        </p>
      </Seccion>
    </div>
  )
}
