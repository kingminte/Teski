-- ============================================================
-- Estado en pagos_cuenta: distingue pagos programados (cuotas
-- futuras) de pagos efectivos.
-- Aplicar en Supabase > SQL Editor
-- ============================================================

alter table pagos_cuenta add column if not exists estado text default 'pagado';

notify pgrst, 'reload schema';
