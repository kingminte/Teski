-- ============================================================
-- Columnas mes/anio en cartolas para mostrar el período real
-- de la cartola en el selector (no la fecha de carga).
-- Aplicar en Supabase > SQL Editor
-- ============================================================

alter table cartolas add column if not exists mes integer;
alter table cartolas add column if not exists anio integer;

-- Backfill: extraer mes/anio del nombre del archivo cuando se pueda.
-- Se ejecuta solo sobre filas que aún no tienen mes/anio poblado.
update cartolas set mes = 1, anio = (regexp_match(nombre_archivo, '(\d{4})'))[1]::int
  where mes is null and nombre_archivo ilike '%enero%' and nombre_archivo ~ '\d{4}';
update cartolas set mes = 2, anio = (regexp_match(nombre_archivo, '(\d{4})'))[1]::int
  where mes is null and nombre_archivo ilike '%febrero%' and nombre_archivo ~ '\d{4}';
update cartolas set mes = 3, anio = (regexp_match(nombre_archivo, '(\d{4})'))[1]::int
  where mes is null and nombre_archivo ilike '%marzo%' and nombre_archivo ~ '\d{4}';
update cartolas set mes = 4, anio = (regexp_match(nombre_archivo, '(\d{4})'))[1]::int
  where mes is null and nombre_archivo ilike '%abril%' and nombre_archivo ~ '\d{4}';
update cartolas set mes = 5, anio = (regexp_match(nombre_archivo, '(\d{4})'))[1]::int
  where mes is null and nombre_archivo ilike '%mayo%' and nombre_archivo ~ '\d{4}';
update cartolas set mes = 6, anio = (regexp_match(nombre_archivo, '(\d{4})'))[1]::int
  where mes is null and nombre_archivo ilike '%junio%' and nombre_archivo ~ '\d{4}';
update cartolas set mes = 7, anio = (regexp_match(nombre_archivo, '(\d{4})'))[1]::int
  where mes is null and nombre_archivo ilike '%julio%' and nombre_archivo ~ '\d{4}';
update cartolas set mes = 8, anio = (regexp_match(nombre_archivo, '(\d{4})'))[1]::int
  where mes is null and nombre_archivo ilike '%agosto%' and nombre_archivo ~ '\d{4}';
update cartolas set mes = 9, anio = (regexp_match(nombre_archivo, '(\d{4})'))[1]::int
  where mes is null and nombre_archivo ilike '%septiembre%' and nombre_archivo ~ '\d{4}';
update cartolas set mes = 10, anio = (regexp_match(nombre_archivo, '(\d{4})'))[1]::int
  where mes is null and nombre_archivo ilike '%octubre%' and nombre_archivo ~ '\d{4}';
update cartolas set mes = 11, anio = (regexp_match(nombre_archivo, '(\d{4})'))[1]::int
  where mes is null and nombre_archivo ilike '%noviembre%' and nombre_archivo ~ '\d{4}';
update cartolas set mes = 12, anio = (regexp_match(nombre_archivo, '(\d{4})'))[1]::int
  where mes is null and nombre_archivo ilike '%diciembre%' and nombre_archivo ~ '\d{4}';

notify pgrst, 'reload schema';
