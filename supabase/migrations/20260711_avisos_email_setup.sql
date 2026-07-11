-- ============================================================
-- Módulo "Avisos por email" — plantillas configurables + registro de envíos
-- ============================================================
-- Capa central de la que cuelgan los avisos de otros módulos (arranca con los
-- 3 de clases). El envío real lo hace la Edge Function genérica `enviar-email`
-- (cartero) vía Resend. Cobranza NO se toca (sigue con enviar-cobranza).
--
-- OJO nombres: la sección de permisos es 'avisos' (NO 'comunicaciones', que
-- pertenece al módulo de documentos de la directiva y no se debe pisar).
-- Las tablas se llaman comunicaciones_plantillas / comunicaciones_envios
-- (no colisionan con la tabla existente `comunicaciones`).
--
-- Idempotente. NO corre solo: aplicar manualmente en el SQL Editor.
-- Correr ANTES el query de verificación de dependencias (ver abajo del archivo).
-- ============================================================

-- Función trigger genérica (reutilizada de socios/bitácora). create-or-replace
-- por idempotencia y para que la migración sea autosuficiente.
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ── 1. Plantillas de aviso (asunto + cuerpo HTML con variables + switch) ────
create table if not exists comunicaciones_plantillas (
  id          uuid primary key default gen_random_uuid(),
  clave       text unique not null,
  nombre      text not null,
  descripcion text,
  asunto      text not null,
  cuerpo_html text not null,
  variables   text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists comunicaciones_plantillas_updated_at on comunicaciones_plantillas;
create trigger comunicaciones_plantillas_updated_at
  before update on comunicaciones_plantillas
  for each row execute function update_updated_at();

alter table comunicaciones_plantillas enable row level security;
drop policy if exists "anon comunicaciones_plantillas" on comunicaciones_plantillas;
create policy "anon comunicaciones_plantillas" on comunicaciones_plantillas for all using (true);

-- ── 2. Semillas: los 3 avisos de clases (cuerpo simple y editable) ──────────
insert into comunicaciones_plantillas (clave, nombre, descripcion, asunto, cuerpo_html, variables) values
  (
    'clases_dia_abierto',
    'Día de clases habilitado',
    'Se envía a los socios cuando se publica una nueva fecha de clases.',
    'Nueva fecha de clases de esquí: {fecha}',
    '<p>Hola {nombre},</p><p>El Centro habilitó una nueva fecha de clases de esquí: <strong>{fecha}</strong>.</p><p>{notas}</p><p>Ingresa a Teski Club para inscribir a tu familia.</p>',
    '{nombre} {fecha} {notas}'
  ),
  (
    'clases_inscripcion',
    'Nueva inscripción (al operador)',
    'Se envía al operador cuando un socio inscribe a alguien en clases.',
    'Nueva inscripción — {socio} ({fecha})',
    '<p>{socio} inscribió a {participantes} para clases de {tipo} el <strong>{fecha}</strong>.</p><p>Entra a Gestionar clases para asignar horario.</p>',
    '{socio} {participantes} {tipo} {fecha}'
  ),
  (
    'clases_horario',
    'Horario confirmado (al socio)',
    'Se envía a los socios del grupo cuando se asigna o reprograma el horario.',
    'Horario confirmado — clase del {fecha}',
    '<p>Hola {nombre},</p><p>La clase de {participantes} quedó agendada para el <strong>{fecha}</strong> de <strong>{hora_inicio}</strong> a <strong>{hora_fin}</strong>{profesor}.</p><p>Te esperamos.</p>',
    '{nombre} {participantes} {fecha} {hora_inicio} {hora_fin} {profesor} {tipo}'
  )
on conflict (clave) do nothing;

-- ── 3. Registro de envíos (log general, espejo genérico de envios_cobranza) ─
create table if not exists comunicaciones_envios (
  id              uuid primary key default gen_random_uuid(),
  plantilla_clave text,
  socio_id        uuid references socios(id) on delete set null,
  email_destino   text,
  asunto          text,
  estado          text not null default 'enviado' check (estado in ('enviado','error')),
  error_mensaje   text,
  contexto        jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists comunicaciones_envios_clave_idx on comunicaciones_envios(plantilla_clave);
create index if not exists comunicaciones_envios_socio_idx on comunicaciones_envios(socio_id);
create index if not exists comunicaciones_envios_fecha_idx on comunicaciones_envios(created_at desc);

alter table comunicaciones_envios enable row level security;
drop policy if exists "anon comunicaciones_envios" on comunicaciones_envios;
create policy "anon comunicaciones_envios" on comunicaciones_envios for all using (true);

-- ── 4. Email del operador (configurable, en config_club: clave/valor/descripcion) ─
insert into config_club (clave, valor, descripcion) values
  ('clases_operador_email', 'nbianchi@andacor.com', 'Email que recibe avisos de nuevas inscripciones de clases')
on conflict (clave) do nothing;

-- ── 5. Permisos: sección nueva 'avisos' (solo admin). NO usar 'comunicaciones'. ─
-- Patrón idempotente (insert ... where not exists), como el resto del sistema.
-- Queda editable desde "Usuarios y permisos" como cualquier otra sección.
insert into permisos_rol (rol, seccion, nivel)
select v.rol, v.seccion, v.nivel
from (values
  ('admin',   'avisos', 'completo'),
  ('gestor',  'avisos', 'ninguno'),
  ('andacor', 'avisos', 'ninguno'),
  ('lector',  'avisos', 'ninguno'),
  ('socio',   'avisos', 'ninguno')
) as v(rol, seccion, nivel)
where not exists (
  select 1 from permisos_rol p where p.rol = v.rol and p.seccion = v.seccion
);

notify pgrst, 'reload schema';
