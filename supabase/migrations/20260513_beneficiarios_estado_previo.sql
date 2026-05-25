-- ============================================================
-- Beneficiarios: estado_previo para sincronización con socio
-- Aplicar en Supabase > SQL Editor
-- ============================================================

alter table beneficiarios add column if not exists estado_previo text;

notify pgrst, 'reload schema';
