-- Memoria de clientes de chat + limpieza semanal de historiales inactivos.
-- Proyecto Supabase detectado por SUPABASE_URL: plxvkchghkvtbjplwyix

create extension if not exists pgcrypto;
create extension if not exists pg_cron with schema extensions;

create table if not exists chat_clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_message_at timestamptz
);

alter table chat_sessions
  add column if not exists client_id uuid references chat_clients(id) on delete cascade,
  add column if not exists last_client_message_at timestamptz;

create index if not exists chat_sessions_client_id_idx
  on chat_sessions(client_id, updated_at desc);

create index if not exists chat_clients_last_message_at_idx
  on chat_clients(last_message_at);

create or replace function update_chat_session_timestamp()
returns trigger language plpgsql as $$
begin
  update chat_sessions
  set
    updated_at = now(),
    last_message = new.content,
    last_client_message_at = case
      when new.role = 'user' then now()
      else last_client_message_at
    end
  where id = new.session_id;

  if new.role = 'user' then
    update chat_clients c
    set
      last_seen_at = now(),
      last_message_at = now()
    from chat_sessions s
    where s.id = new.session_id
      and s.client_id = c.id;
  end if;

  return new;
end;
$$;

drop trigger if exists chat_messages_update_session on chat_messages;
create trigger chat_messages_update_session
  after insert on chat_messages
  for each row execute function update_chat_session_timestamp();

alter table chat_clients enable row level security;

drop policy if exists "service_role_all_clients" on chat_clients;
create policy "service_role_all_clients" on chat_clients
  for all using (true) with check (true);

create or replace function cleanup_inactive_chat_clients()
returns void language plpgsql security definer as $$
begin
  delete from chat_clients
  where coalesce(last_message_at, last_seen_at, created_at) < now() - interval '2 months';

  delete from chat_sessions
  where client_id is null
    and coalesce(last_client_message_at, updated_at, created_at) < now() - interval '2 months';
end;
$$;

select cron.unschedule('cleanup-inactive-chat-clients')
where exists (
  select 1 from cron.job where jobname = 'cleanup-inactive-chat-clients'
);

select cron.schedule(
  'cleanup-inactive-chat-clients',
  '0 4 * * 0',
  $$select cleanup_inactive_chat_clients();$$
);
