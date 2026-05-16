-- ============================================================
-- Sistema de automatización de cobro de cuotas
-- Aplicar en Supabase > SQL Editor
-- ============================================================

-- Configuración del club (datos bancarios + flags de cobranza)
create table if not exists config_club (
  id uuid primary key default gen_random_uuid(),
  clave text unique not null,
  valor text not null,
  descripcion text
);

insert into config_club (clave, valor, descripcion) values
  ('banco_nombre', 'Santander', 'Banco del club'),
  ('banco_tipo_cuenta', 'Cuenta corriente', 'Tipo de cuenta'),
  ('banco_numero_cuenta', '0-082-66-00910-1', 'Número de cuenta'),
  ('banco_rut', '65.173.315-4', 'RUT del titular'),
  ('banco_titular', 'Teski Club', 'Nombre del titular'),
  ('banco_email', 'tesoreria@teski.cl', 'Email de notificación'),
  ('cobranza_asunto', 'Recordatorio de cuota social {anio} — Teski Club', 'Asunto del email'),
  ('cobranza_automatica', 'false', 'Envío automático mensual'),
  ('cobranza_copia_admin', 'false', 'Enviar copia al administrador'),
  ('cobranza_incluir_datos_bancarios', 'true', 'Incluir datos bancarios en el cuerpo')
on conflict (clave) do nothing;

-- Historial de envíos de cobranza
create table if not exists envios_cobranza (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid references socios(id) on delete set null,
  periodo_id uuid references periodos_cuota(id),
  tipo text not null check (tipo in ('masivo', 'individual')),
  email_destino text,
  monto_pendiente integer,
  estado text default 'enviado' check (estado in ('enviado', 'error', 'simulado')),
  error_mensaje text,
  created_at timestamptz default now()
);

create index if not exists envios_cobranza_socio_idx on envios_cobranza(socio_id);
create index if not exists envios_cobranza_periodo_idx on envios_cobranza(periodo_id);
create index if not exists envios_cobranza_fecha_idx on envios_cobranza(created_at desc);

-- RLS
alter table envios_cobranza enable row level security;
drop policy if exists "auth envios_cobranza" on envios_cobranza;
create policy "auth envios_cobranza" on envios_cobranza
  for all using (auth.role() = 'authenticated');

alter table config_club enable row level security;
drop policy if exists "auth config_club" on config_club;
create policy "auth config_club" on config_club
  for all using (auth.role() = 'authenticated');

notify pgrst, 'reload schema';
