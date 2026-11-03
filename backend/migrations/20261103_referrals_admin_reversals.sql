-- Acciones administrativas explícitas sobre recompensas.
-- No se aplica automáticamente. Solo permite revertir crédito disponible;
-- los créditos usados requieren una política de reembolso separada.

create table if not exists public.referral_admin_actions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('reverse_reward')),
  reward_id uuid not null references public.referral_rewards(id) on delete restrict,
  referral_id uuid references public.referrals(id) on delete restrict,
  reason text not null check (char_length(trim(reason)) between 10 and 500),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists referral_admin_actions_reward_idx
  on public.referral_admin_actions(reward_id, created_at desc);

alter table public.referral_admin_actions enable row level security;
revoke all on table public.referral_admin_actions from anon, authenticated;
grant all on table public.referral_admin_actions to service_role;

create or replace function public.reverse_referral_reward(
  p_reward_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward record;
  v_action_key text;
begin
  if p_actor_user_id is null or char_length(trim(coalesce(p_reason, ''))) not between 10 and 500 then
    raise exception 'La reversión requiere administrador y una razón de 10 a 500 caracteres' using errcode = '22023';
  end if;

  select id, referral_id, recipient_customer_id, source_order_id, reward_type, amount, currency, status
    into v_reward
    from public.referral_rewards
   where id = p_reward_id
   for update;
  if not found then
    raise exception 'Recompensa no encontrada' using errcode = 'P0002';
  end if;
  if v_reward.status = 'reversed' then
    return jsonb_build_object('reversed', true, 'reward_id', v_reward.id, 'amount', v_reward.amount, 'currency', v_reward.currency, 'idempotent', true);
  end if;
  if v_reward.reward_type <> 'referrer_credit' or v_reward.status <> 'available' then
    raise exception 'Solo se puede revertir crédito disponible; el crédito usado requiere política de reembolso' using errcode = '22023';
  end if;

  v_action_key := format('reverse_reward:%s', v_reward.id);
  update public.referral_rewards
     set status = 'reversed', reversed_at = now(), updated_at = now()
   where id = v_reward.id and status = 'available';

  insert into public.referral_wallet_entries (
    customer_id, reward_id, order_id, entry_type, amount, currency, idempotency_key, metadata
  ) values (
    v_reward.recipient_customer_id, v_reward.id, v_reward.source_order_id, 'reversal', v_reward.amount,
    v_reward.currency, format('reward:%s:reversal', v_reward.id), jsonb_build_object('reason', trim(p_reason))
  ) on conflict (idempotency_key) do nothing;

  insert into public.referral_admin_actions (
    actor_user_id, action, reward_id, referral_id, reason, idempotency_key, metadata
  ) values (
    p_actor_user_id, 'reverse_reward', v_reward.id, v_reward.referral_id, trim(p_reason), v_action_key, '{}'::jsonb
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object('reversed', true, 'reward_id', v_reward.id, 'amount', v_reward.amount, 'currency', v_reward.currency);
end;
$$;

revoke all on function public.reverse_referral_reward(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reverse_referral_reward(uuid, uuid, text) to service_role;
