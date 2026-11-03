-- Suscripciones Web Push opcionales para avisar al referente cuando se confirme
-- la primera compra atribuida a su enlace.
alter table public.referral_rewards add column if not exists push_notified_at timestamptz;

create table if not exists public.customer_notification_preferences (
  customer_id uuid primary key references public.customer_profiles(id) on delete cascade,
  referral_purchase_push_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer_profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_push_subscriptions_customer_idx
  on public.customer_push_subscriptions(customer_id, is_active);

alter table public.customer_notification_preferences enable row level security;
alter table public.customer_push_subscriptions enable row level security;
revoke all on table public.customer_notification_preferences, public.customer_push_subscriptions from anon, authenticated;
grant all on table public.customer_notification_preferences, public.customer_push_subscriptions to service_role;

