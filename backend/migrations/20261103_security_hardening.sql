-- Hardening de Data API para tablas que solo debe tocar el backend.
-- El backend usa service_role, por lo que no necesita exponer estas escrituras
-- a anon/authenticated a través de PostgREST.

create extension if not exists pgcrypto;

alter table public.payment_methods enable row level security;

drop policy if exists "payment_methods_read_public" on public.payment_methods;
drop policy if exists "payment_methods_insert_authenticated" on public.payment_methods;
drop policy if exists "payment_methods_update_authenticated" on public.payment_methods;
drop policy if exists "payment_methods_delete_authenticated" on public.payment_methods;

revoke all on table public.payment_methods from anon, authenticated;
grant select, insert, update, delete on table public.payment_methods to service_role;

-- Los identificadores de chat existentes no cambian; solo se endurece la
-- generación de nuevas sesiones a 128 bits aleatorios.
alter table public.chat_sessions
  alter column id set default ('chat-' || encode(gen_random_bytes(16), 'hex'));
