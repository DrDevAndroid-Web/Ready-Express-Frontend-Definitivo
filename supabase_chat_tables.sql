-- Sesiones de chat con clientes
create table if not exists chat_sessions (
  id          text primary key default ('chat-' || substr(md5(random()::text), 1, 10)),
  status      text not null default 'ai' check (status in ('ai', 'handoff', 'resolved')),
  client_contact text,                  -- WhatsApp o email que dejó el cliente
  last_message text,                    -- Último mensaje para preview en la lista
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

-- Actualiza updated_at automáticamente al insertar mensaje
create or replace function update_chat_session_timestamp()
returns trigger language plpgsql as $$
begin
  update chat_sessions
  set updated_at = now(), last_message = new.content
  where id = new.session_id;
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

create policy "service_role_all_sessions" on chat_sessions
  for all using (true) with check (true);

create policy "service_role_all_messages" on chat_messages
  for all using (true) with check (true);
