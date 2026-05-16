-- ============================================================
-- Agregar columna `concepto` a pagos_cuota para registrar el
-- detalle del concepto aplicado al conciliar desde la cartola.
-- Aplicar en Supabase > SQL Editor
-- ============================================================

alter table pagos_cuota add column if not exists concepto text;

notify pgrst, 'reload schema';
