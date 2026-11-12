-- Embudo de referidos. Los eventos server-side permiten separar marketing
-- de atribuciones, compras y recompensas realmente confirmadas.
create table if not exists public.referral_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('cta_click', 'attribution_captured', 'registration_completed', 'first_purchase', 'reward_issued')),
  referral_code_id uuid references public.referral_codes(id) on delete set null,
  referral_claim_id uuid references public.referral_claims(id) on delete set null,
  referral_id uuid references public.referrals(id) on delete set null,
  customer_id uuid references public.customer_profiles(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  placement text,
  session_id text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists referral_events_idempotency_key_uidx on public.referral_events(idempotency_key) where idempotency_key is not null;
create index if not exists referral_events_type_occurred_idx on public.referral_events(event_type, occurred_at desc);
create index if not exists referral_events_placement_occurred_idx on public.referral_events(placement, occurred_at desc) where placement is not null;

alter table public.referral_events enable row level security;
revoke all on table public.referral_events from anon, authenticated;
grant all on table public.referral_events to service_role;
