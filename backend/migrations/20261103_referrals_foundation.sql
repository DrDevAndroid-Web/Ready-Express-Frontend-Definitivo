-- Fundamentos del programa de referidos.
-- El backend es la autoridad y usa service_role; no se expone ninguna de estas
-- tablas directamente a anon/authenticated mediante la Data API.

create extension if not exists pgcrypto;

create table if not exists public.referral_programs (
  id uuid primary key default gen_random_uuid(),
  singleton_key text not null default 'default' unique check (singleton_key = 'default'),
  enabled boolean not null default false,
  name text not null default 'Programa de referidos',
  description text,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  starts_at timestamptz,
  ends_at timestamptz,
  attribution_window_days integer not null default 30 check (attribution_window_days between 1 and 365),
  qualification_event text not null default 'payment_successful' check (qualification_event = 'payment_successful'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

insert into public.referral_programs (singleton_key)
values ('default')
on conflict (singleton_key) do nothing;

create table if not exists public.referral_rules (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.referral_programs(id) on delete cascade,
  beneficiary_type text not null check (beneficiary_type in ('referred_customer', 'referrer')),
  reward_type text not null check (reward_type in ('discount_fixed', 'discount_percent', 'credit_fixed', 'credit_percent')),
  amount numeric(12,2) not null check (amount > 0),
  minimum_purchase numeric(12,2) not null default 0 check (minimum_purchase >= 0),
  maximum_discount numeric(12,2) check (maximum_discount is null or maximum_discount > 0),
  expires_after_days integer check (expires_after_days is null or expires_after_days between 1 and 3650),
  max_rewards_per_referrer integer check (max_rewards_per_referrer is null or max_rewards_per_referrer between 1 and 100000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (beneficiary_type <> 'referred_customer' or reward_type in ('discount_fixed', 'discount_percent')),
  check (beneficiary_type <> 'referrer' or reward_type in ('credit_fixed', 'credit_percent')),
  check (reward_type not like '%percent' or amount <= 100)
);

create unique index if not exists referral_rules_one_active_per_beneficiary
  on public.referral_rules(program_id, beneficiary_type)
  where active;

create index if not exists referral_rules_program_idx
  on public.referral_rules(program_id, active);

create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.customer_profiles(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z2-9]{8,16}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists referral_codes_active_code_idx
  on public.referral_codes(code)
  where active;

create table if not exists public.referral_claims (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.referral_codes(id) on delete restrict,
  referrer_customer_id uuid not null references public.customer_profiles(id) on delete restrict,
  token_hash text not null unique,
  expires_at timestamptz not null,
  claimed_by_customer_id uuid references public.customer_profiles(id) on delete set null,
  claimed_at timestamptz,
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  check (claimed_at is null or claimed_at >= created_at)
);

create index if not exists referral_claims_active_idx
  on public.referral_claims(token_hash, expires_at);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.referral_codes(id) on delete restrict,
  referrer_customer_id uuid not null references public.customer_profiles(id) on delete restrict,
  referred_customer_id uuid references public.customer_profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'registered', 'purchase_pending', 'qualified', 'rewarded', 'rejected', 'cancelled')),
  first_eligible_order_id uuid references public.orders(id) on delete set null,
  qualified_at timestamptz,
  rejection_reason text,
  rule_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (referred_customer_id is null or referred_customer_id <> referrer_customer_id)
);

create unique index if not exists referrals_one_attribution_per_customer
  on public.referrals(referred_customer_id)
  where referred_customer_id is not null;

create unique index if not exists referrals_one_order_once
  on public.referrals(first_eligible_order_id)
  where first_eligible_order_id is not null;

create index if not exists referrals_referrer_status_idx
  on public.referrals(referrer_customer_id, status, created_at desc);

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals(id) on delete restrict,
  recipient_customer_id uuid not null references public.customer_profiles(id) on delete restrict,
  source_order_id uuid not null references public.orders(id) on delete restrict,
  reward_type text not null check (reward_type in ('referred_discount', 'referrer_credit')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending', 'available', 'used', 'reversed', 'expired', 'rejected')),
  idempotency_key text not null unique,
  rule_snapshot jsonb not null default '{}'::jsonb,
  available_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or available_at is null or expires_at > available_at)
);

create unique index if not exists referral_rewards_one_type_per_referral
  on public.referral_rewards(referral_id, reward_type);

create index if not exists referral_rewards_recipient_status_idx
  on public.referral_rewards(recipient_customer_id, status, created_at desc);

create table if not exists public.referral_wallet_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer_profiles(id) on delete restrict,
  reward_id uuid references public.referral_rewards(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  entry_type text not null check (entry_type in ('credit', 'debit', 'reversal', 'expiry')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists referral_wallet_entries_customer_idx
  on public.referral_wallet_entries(customer_id, created_at desc);

create table if not exists public.order_adjustments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  adjustment_type text not null check (adjustment_type in ('referral_discount', 'referral_credit')),
  source_id uuid,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists order_adjustments_one_source
  on public.order_adjustments(order_id, adjustment_type, source_id)
  where source_id is not null;

-- Defense in depth: el backend opera con service_role y las APIs públicas pasan
-- por Express, que aplica autorización por cliente/rol.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'referral_programs', 'referral_rules', 'referral_codes', 'referral_claims',
    'referrals', 'referral_rewards', 'referral_wallet_entries', 'order_adjustments'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end $$;
