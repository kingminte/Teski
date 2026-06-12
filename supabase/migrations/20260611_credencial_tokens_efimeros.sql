-- ============================================================
-- Credencial Virtual — QR rotativo con tokens efímeros (60s)
-- ============================================================
-- Reemplaza el token permanente (socios.credencial_token) por tokens
-- efímeros en tabla propia. Cada token vive 60s; el cliente rota el QR
-- automáticamente. Cleanup oportunista en los RPCs + cron nightly aparte.
-- Idempotente.
-- ============================================================

create table if not exists credencial_tokens (
  token text primary key,
  socio_id uuid not null references socios(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_credencial_tokens_socio_expires
  on credencial_tokens(socio_id, expires_at);
create index if not exists idx_credencial_tokens_expires
  on credencial_tokens(expires_at);

alter table credencial_tokens enable row level security;
drop policy if exists "anon credencial_tokens" on credencial_tokens;
create policy "anon credencial_tokens" on credencial_tokens for all using (true);

-- Token alfanumérico de 32 chars.
create or replace function gen_credencial_token_efimero() returns text
language plpgsql
as $$
declare
  v_chars text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  v_result text := '';
  v_i integer;
begin
  for v_i in 1..32 loop
    v_result := v_result || substr(v_chars, 1 + floor(random() * length(v_chars))::integer, 1);
  end loop;
  return v_result;
end;
$$;

-- Crea un token efímero (60s) para un socio. Limpia los vencidos del socio.
create or replace function crear_token_credencial(p_socio_id uuid)
returns table(token text, expires_at timestamptz)
language plpgsql
as $$
declare
  v_token text;
  v_expires timestamptz;
begin
  -- expires_at calificado con la tabla: evita ambigüedad con la columna
  -- de salida del RETURNS TABLE (que también se llama expires_at).
  delete from credencial_tokens where socio_id = p_socio_id and credencial_tokens.expires_at < now();

  v_token := gen_credencial_token_efimero();
  v_expires := now() + interval '60 seconds';

  insert into credencial_tokens (token, socio_id, expires_at)
    values (v_token, p_socio_id, v_expires);

  return query select v_token, v_expires;
end;
$$;

-- Valida un token: devuelve socio_id si está vigente, null si no. Limpia vencidos.
create or replace function validar_token_credencial(p_token text)
returns uuid
language plpgsql
as $$
declare
  v_socio_id uuid;
begin
  delete from credencial_tokens where expires_at < now();

  select socio_id into v_socio_id
    from credencial_tokens
    where token = p_token and expires_at > now();

  return v_socio_id;
end;
$$;

grant execute on function gen_credencial_token_efimero() to anon, authenticated;
grant execute on function crear_token_credencial(uuid) to anon, authenticated;
grant execute on function validar_token_credencial(text) to anon, authenticated;

-- Eliminar el sistema anterior (token permanente)
drop trigger if exists trg_socios_credencial_token on socios;
drop function if exists trg_socios_credencial_token();
drop function if exists gen_credencial_token();
alter table socios drop column if exists credencial_token;

notify pgrst, 'reload schema';
