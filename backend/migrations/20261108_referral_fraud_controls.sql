-- Registro antifraude de referidos. No guarda IP cruda: solo HMAC generado por el backend.
create table if not exists public.referral_risk_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('claim_attempt', 'registration_attempt', 'purchase_attempt', 'risk_review')),
  decision text not null check (decision in ('allow', 'review', 'block')),
  enforced boolean not null default false,
  risk_score integer not null default 0 check (risk_score >= 0),
  reason_codes text[] not null default '{}',
  referral_code_id uuid references public.referral_codes(id) on delete set null,
  referral_claim_id uuid references public.referral_claims(id) on delete set null,
  referral_id uuid references public.referrals(id) on delete set null,
  customer_id uuid references public.customer_profiles(id) on delete set null,
  ip_hash text,
  device_hash text,
  session_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists referral_risk_events_decision_created_idx on public.referral_risk_events(decision, created_at desc);
create index if not exists referral_risk_events_ip_created_idx on public.referral_risk_events(ip_hash, created_at desc);
create index if not exists referral_risk_events_device_created_idx on public.referral_risk_events(device_hash, created_at desc);
create index if not exists referral_risk_events_code_created_idx on public.referral_risk_events(referral_code_id, created_at desc);

alter table public.referral_risk_events enable row level security;
revoke all on table public.referral_risk_events from anon, authenticated;
grant select, insert, update, delete on table public.referral_risk_events to service_role;
