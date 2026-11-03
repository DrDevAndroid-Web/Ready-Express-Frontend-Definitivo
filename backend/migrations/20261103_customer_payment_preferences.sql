-- Preferencias de pago por cliente.
-- No almacena datos de tarjeta; solo identifica los métodos que el cliente prefiere.

create table if not exists public.customer_payment_preferences (
  customer_id uuid primary key references public.customer_profiles(id) on delete cascade,
  preferred_methods jsonb not null default '[]'::jsonb check (jsonb_typeof(preferred_methods) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_payment_preferences enable row level security;
revoke all on table public.customer_payment_preferences from anon, authenticated;
grant all on table public.customer_payment_preferences to service_role;
