-- Uso atómico del saldo de referidos como descuento en una orden.
-- El backend mantiene un fallback durante el despliegue escalonado.

create unique index if not exists order_adjustments_one_referral_credit_per_order
  on public.order_adjustments(order_id, adjustment_type)
  where adjustment_type = 'referral_credit';

create or replace function public.redeem_referral_wallet_credit(
  p_customer_id uuid,
  p_order_id uuid,
  p_amount numeric,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(12,2);
  v_adjustment record;
  v_idempotency text := format('order:%s:referral_credit', p_order_id);
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El importe del crédito debe ser mayor que cero' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text, 0));

  select coalesce(sum(case when entry_type = 'credit' then amount else -amount end), 0)
    into v_balance
    from public.referral_wallet_entries
   where customer_id = p_customer_id
     and currency = p_currency;

  if v_balance < p_amount then
    raise exception 'El saldo de referidos es insuficiente' using errcode = 'P0001';
  end if;

  insert into public.order_adjustments(order_id, adjustment_type, source_id, amount, currency, metadata)
  values (p_order_id, 'referral_credit', p_customer_id, p_amount, p_currency, jsonb_build_object('source', 'referral_wallet'))
  on conflict (order_id, adjustment_type) where adjustment_type = 'referral_credit' do nothing
  returning id, order_id, adjustment_type, amount, currency into v_adjustment;

  if v_adjustment.id is null then
    select id, order_id, adjustment_type, amount, currency
      into v_adjustment
      from public.order_adjustments
     where order_id = p_order_id and adjustment_type = 'referral_credit';
  end if;

  insert into public.referral_wallet_entries(
    customer_id, order_id, entry_type, amount, currency, idempotency_key, metadata
  ) values (
    p_customer_id, p_order_id, 'debit', p_amount, p_currency, v_idempotency,
    jsonb_build_object('source', 'referral_wallet', 'adjustment_id', v_adjustment.id)
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'id', v_adjustment.id,
    'order_id', v_adjustment.order_id,
    'adjustment_type', v_adjustment.adjustment_type,
    'amount', v_adjustment.amount,
    'currency', v_adjustment.currency
  );
end;
$$;

revoke all on function public.redeem_referral_wallet_credit(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.redeem_referral_wallet_credit(uuid, uuid, numeric, text) to service_role;
