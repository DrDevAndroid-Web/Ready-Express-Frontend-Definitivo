-- Base del flujo unificado ReadyExpressNow + TropiPay.

alter table public.orders
  add column if not exists order_reference text,
  add column if not exists customer_id uuid references auth.users(id) on delete set null,
  add column if not exists payment_status text not null default 'pending',
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists printed_at timestamptz;

create unique index if not exists orders_order_reference_uidx
  on public.orders(order_reference)
  where order_reference is not null;

create table if not exists public.customer_profiles (
  id uuid primary key default gen_random_uuid(), auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  nombre text not null, apellidos text not null, email text not null, telefono text,
  documento_identidad text, avatar_url text, activo boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('cliente', 'admin', 'operador', 'repartidor', 'dueno_tienda')),
  created_at timestamptz not null default now(), unique (user_id, role)
);

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customer_profiles(id) on delete cascade,
  alias text not null, direccion text not null, provincia text, municipio text, referencia text,
  telefono_contacto text, es_predeterminada boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete restrict,
  customer_id uuid references auth.users(id) on delete set null, provider text not null check (provider in ('tropipay', 'manual')),
  provider_payment_id text, paymentcard_id text, bank_order_code text, external_reference text,
  amount numeric(12,2) not null check (amount > 0), currency text not null default 'USD',
  status text not null default 'pending' check (status in ('pending', 'processing', 'successful', 'failed', 'cancelled', 'refunded')),
  payment_url text, signature_verified boolean not null default false, raw_payload jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create unique index if not exists payment_transactions_provider_reference_uidx
  on public.payment_transactions(provider, external_reference)
  where external_reference is not null;

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(), payment_transaction_id uuid not null references public.payment_transactions(id) on delete cascade,
  event_type text not null, payload jsonb not null, signature_verified boolean not null default false,
  received_at timestamptz not null default now(), processed_at timestamptz, processing_error text
);

create table if not exists public.delivery_confirmations (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  bucket_name text not null, object_path text not null, mime_type text not null default 'image/webp',
  file_size integer, checksum text, uploaded_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'rejected')),
  notes text, created_at timestamptz not null default now(), verified_at timestamptz
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  payment_transaction_id uuid references public.payment_transactions(id) on delete cascade,
  type text not null, title text not null, message text not null, payload jsonb,
  read_at timestamptz, created_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.payment_events enable row level security;
alter table public.delivery_confirmations enable row level security;
alter table public.notifications enable row level security;

drop policy if exists customer_profiles_self_select on public.customer_profiles;
create policy customer_profiles_self_select on public.customer_profiles
  for select to authenticated using ((select auth.uid()) = auth_user_id);
drop policy if exists customer_profiles_self_update on public.customer_profiles;
create policy customer_profiles_self_update on public.customer_profiles
  for update to authenticated using ((select auth.uid()) = auth_user_id)
  with check ((select auth.uid()) = auth_user_id);
drop policy if exists customer_addresses_self_access on public.customer_addresses;
create policy customer_addresses_self_access on public.customer_addresses
  for all to authenticated using (exists (select 1 from public.customer_profiles p where p.id = customer_addresses.customer_id and p.auth_user_id = (select auth.uid())))
  with check (exists (select 1 from public.customer_profiles p where p.id = customer_addresses.customer_id and p.auth_user_id = (select auth.uid())));
drop policy if exists notifications_self_select on public.notifications;
create policy notifications_self_select on public.notifications
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Las escrituras privilegiadas de pagos, eventos y entregas se realizan desde el backend.
