-- ============================================================
-- Persistencia del cuerpo del email de cobranza
-- Aplicar en Supabase > SQL Editor
-- ============================================================

insert into config_club (clave, valor, descripcion) values
  ('cobranza_cuerpo', '', 'Cuerpo del email de cobranza')
on conflict (clave) do nothing;

notify pgrst, 'reload schema';
