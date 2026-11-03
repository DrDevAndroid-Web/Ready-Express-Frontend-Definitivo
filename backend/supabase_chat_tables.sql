-- Sesiones de chat con clientes
create extension if not exists pgcrypto;
create extension if not exists pg_cron with schema extensions;

create table if not exists chat_clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table if not exists chat_sessions (
  id          text primary key default ('chat-' || encode(gen_random_bytes(16), 'hex')),
  client_id   uuid references chat_clients(id) on delete cascade,
  status      text not null default 'ai' check (status in ('ai', 'handoff', 'resolved')),
  client_contact text,                  -- WhatsApp o email que dejó el cliente
  last_message text,                    -- Último mensaje para preview en la lista
  last_client_message_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Mensajes de cada sesión
create table if not exists chat_messages (
  id          bigserial primary key,
  session_id  text not null references chat_sessions(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant', 'admin')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists chat_messages_session_idx on chat_messages(session_id, created_at);
create index if not exists chat_sessions_client_id_idx on chat_sessions(client_id, updated_at desc);
create index if not exists chat_clients_last_message_at_idx on chat_clients(last_message_at);

-- Actualiza updated_at automáticamente al insertar mensaje
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

-- RLS: solo service_role puede leer/escribir (el backend usa service_role)
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;
alter table chat_clients enable row level security;

drop policy if exists "service_role_all_sessions" on chat_sessions;
create policy "service_role_all_sessions" on chat_sessions
  for all using (true) with check (true);

drop policy if exists "service_role_all_messages" on chat_messages;
create policy "service_role_all_messages" on chat_messages
  for all using (true) with check (true);

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
