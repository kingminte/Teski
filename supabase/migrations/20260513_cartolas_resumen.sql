-- ============================================================
-- Persistencia del resumen financiero por cartola
-- Aplicar en Supabase > SQL Editor
-- ============================================================

alter table cartolas add column if not exists saldo_inicial integer default 0;
alter table cartolas add column if not exists saldo_final integer default 0;
alter table cartolas add column if not exists total_abonos integer default 0;
alter table cartolas add column if not exists total_cargos integer default 0;

notify pgrst, 'reload schema';
