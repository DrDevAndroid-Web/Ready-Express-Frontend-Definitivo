-- Calificación y acreditación atómica de un referido.
-- Esta migración no se aplica automáticamente. El backend usa service_role
-- y la función queda cerrada a anon/authenticated.

create or replace function public.qualify_referral_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_adjustment record;
  v_referral record;
  v_snapshot jsonb;
  v_referrer_rule jsonb;
  v_referrer_reward_id uuid;
  v_credit numeric(12,2) := 0;
  v_limit integer;
  v_reward_count integer := 0;
  v_reward_status text := 'available';
  v_expires_at timestamptz;
  v_idempotency text;
begin
  select id, status, payment_status, total, products_subtotal
    into v_order
    from public.orders
   where id = p_order_id;

  if not found then
    return jsonb_build_object('qualified', false, 'reason', 'order_not_found');
  end if;
  if lower(coalesce(v_order.payment_status, '')) <> 'successful' then
    return jsonb_build_object('qualified', false, 'reason', 'payment_not_successful');
  end if;
  if lower(coalesce(v_order.status, '')) in ('cancelled', 'payment_rejected') then
    return jsonb_build_object('qualified', false, 'reason', 'order_not_eligible');
  end if;

  select id, source_id, amount, currency, metadata
    into v_adjustment
    from public.order_adjustments
   where order_id = p_order_id
     and adjustment_type = 'referral_discount'
   order by created_at asc
   limit 1;
  if not found or v_adjustment.source_id is null then
    return jsonb_build_object('qualified', false, 'reason', 'not_a_referral_order');
  end if;

  -- El lock serializa confirmaciones repetidas y pedidos del mismo referido.
  select id, referrer_customer_id, referred_customer_id, status, rule_snapshot
    into v_referral
    from public.referrals
   where id = v_adjustment.source_id
   for update;
  if not found then
    return jsonb_build_object('qualified', false, 'reason', 'referral_not_found');
  end if;
  if v_referral.status = 'rewarded' then
    return jsonb_build_object('qualified', true, 'rewarded', true, 'idempotent', true, 'referral_id', v_referral.id);
  end if;
  if v_referral.status not in ('purchase_pending', 'qualified') then
    return jsonb_build_object('qualified', false, 'reason', 'referral_not_pending');
  end if;

  if v_referral.status = 'purchase_pending' then
    update public.referrals
       set status = 'qualified', qualified_at = coalesce(qualified_at, now()), updated_at = now()
     where id = v_referral.id;
  end if;

  v_snapshot := coalesce(v_adjustment.metadata->'rule_snapshot', v_referral.rule_snapshot, '{}'::jsonb);
  insert into public.referral_rewards (
    referral_id, recipient_customer_id, source_order_id, reward_type, amount, currency,
    status, idempotency_key, rule_snapshot, available_at, used_at
  ) values (
    v_referral.id, v_referral.referred_customer_id, p_order_id, 'referred_discount',
    v_adjustment.amount, v_adjustment.currency, 'used',
    format('referral:%s:referred_discount:%s', v_referral.id, p_order_id),
    coalesce(v_snapshot->'referred', v_snapshot), now(), now()
  ) on conflict (idempotency_key) do nothing;

  v_referrer_rule := v_snapshot->'referrer';
  if v_referrer_rule is not null and jsonb_typeof(v_referrer_rule) = 'object' then
    if v_referrer_rule->>'reward_type' = 'credit_fixed' then
      v_credit := round((v_referrer_rule->>'amount')::numeric, 2);
    elsif v_referrer_rule->>'reward_type' = 'credit_percent' then
      v_credit := round((coalesce(v_order.total, v_order.products_subtotal, 0) * (v_referrer_rule->>'amount')::numeric / 100), 2);
    end if;
    if v_credit > 0 and v_referral.referrer_customer_id is not null then
      -- Un lock advisory por referente evita superar el máximo con dos órdenes simultáneas.
      perform pg_advisory_xact_lock(hashtextextended(v_referral.referrer_customer_id::text, 0));
      v_limit := nullif(v_referrer_rule->>'max_rewards_per_referrer', '')::integer;
      if v_limit is not null then
        select count(*) into v_reward_count
          from public.referral_rewards
         where recipient_customer_id = v_referral.referrer_customer_id
           and reward_type = 'referrer_credit'
           and status in ('available', 'used');
        if v_reward_count >= v_limit then v_reward_status := 'rejected'; end if;
      end if;
      if nullif(v_referrer_rule->>'expires_after_days', '') is not null then
        v_expires_at := now() + ((v_referrer_rule->>'expires_after_days')::integer * interval '1 day');
      end if;
      v_idempotency := format('referral:%s:referrer_credit:%s', v_referral.id, p_order_id);
      insert into public.referral_rewards (
        referral_id, recipient_customer_id, source_order_id, reward_type, amount, currency,
        status, idempotency_key, rule_snapshot, available_at, expires_at
      ) values (
        v_referral.id, v_referral.referrer_customer_id, p_order_id, 'referrer_credit', v_credit, v_adjustment.currency,
        v_reward_status, v_idempotency, v_referrer_rule,
        case when v_reward_status = 'available' then now() else null end, v_expires_at
      ) on conflict (idempotency_key) do nothing
      returning id into v_referrer_reward_id;

      if v_reward_status = 'available' then
        if v_referrer_reward_id is null then
          select id into v_referrer_reward_id from public.referral_rewards where idempotency_key = v_idempotency;
        end if;
        insert into public.referral_wallet_entries (
          customer_id, reward_id, order_id, entry_type, amount, currency, idempotency_key, metadata
        ) values (
          v_referral.referrer_customer_id, v_referrer_reward_id, p_order_id, 'credit', v_credit,
          v_adjustment.currency, format('reward:%s:credit', v_referrer_reward_id),
          jsonb_build_object('source', 'referral_qualification')
        ) on conflict (idempotency_key) do nothing;
      end if;
    end if;
  end if;

  update public.referrals set status = 'rewarded', updated_at = now() where id = v_referral.id;
  return jsonb_build_object('qualified', true, 'rewarded', true, 'referral_id', v_referral.id, 'credit', v_credit);
end;
$$;

revoke all on function public.qualify_referral_order(uuid) from public, anon, authenticated;
grant execute on function public.qualify_referral_order(uuid) to service_role;
