-- Dispositivos desde los que cada usuario ya inició sesión. Al entrar desde uno nuevo se le
-- avisa por email. device_hash = sha256(user_id + id de dispositivo del navegador, o el
-- user agent si el cliente no lo manda): nunca se guarda el identificador en claro.
-- Sin políticas RLS: solo el backend (service_role) la lee y escribe.
create table if not exists public.customer_known_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_hash text not null,
  user_agent text,
  ip text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_hash)
);

alter table public.customer_known_devices enable row level security;
