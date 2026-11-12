-- El descuento del cliente referido se consume una sola vez, al confirmarse
-- el pago. Una orden cancelada antes del pago puede liberar su reserva.
-- Aplicar antes de desplegar el backend que consulta discount_used_at.

set lock_timeout = '5s';

alter table public.referrals
  add column if not exists discount_used_at timestamptz;

-- Recupera compras ya confirmadas, incluso si la calificación de recompensas
-- quedó incompleta. La marca persiste aunque se libere first_eligible_order_id.
update public.referrals r
   set discount_used_at = coalesce(
     (select min(coalesce(rr.used_at, rr.created_at))
        from public.referral_rewards rr
       where rr.referral_id = r.id
         and rr.reward_type = 'referred_discount'
         and rr.status = 'used'),
     r.qualified_at,
     now()
   )
 where r.discount_used_at is null
   and (
     r.status in ('qualified', 'rewarded')
     or exists (
       select 1 from public.referral_rewards rr
        where rr.referral_id = r.id
          and rr.reward_type = 'referred_discount'
          and rr.status = 'used'
     )
     or exists (
       select 1
         from public.order_adjustments oa
         join public.orders o on o.id = oa.order_id
        where oa.source_id = r.id
          and oa.adjustment_type = 'referral_discount'
          and lower(o.payment_status) = 'successful'
     )
   );

-- El estado de pago es la fuente de verdad. La marca se escribe en la misma
-- transacción que confirma el pago, aunque la RPC de recompensas falle luego.
create or replace function public.mark_referral_discount_used()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.referrals r
     set discount_used_at = now(), updated_at = now()
    from public.order_adjustments oa
   where oa.order_id = new.id
     and oa.adjustment_type = 'referral_discount'
     and r.id = oa.source_id
     and r.discount_used_at is null;
  return new;
end;
$$;

revoke all on function public.mark_referral_discount_used() from public, anon, authenticated;

drop trigger if exists orders_mark_referral_discount_used on public.orders;
create trigger orders_mark_referral_discount_used
after update of payment_status on public.orders
for each row
when (new.payment_status = 'successful' and old.payment_status is distinct from new.payment_status)
execute function public.mark_referral_discount_used();
