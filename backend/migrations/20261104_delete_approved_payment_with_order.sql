-- Un comprobante aprobado de prueba representa la orden completa.
-- Mantiene payments y orders como tablas separadas, pero elimina ambas filas
-- dentro de la misma transacción cuando el administrador confirma ELIMINAR.

create or replace function public.delete_approved_payment_and_order(
  p_payment_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_order_id uuid;
  v_payment_count integer;
  v_reward_count integer;
  v_wallet_count integer;
begin
  if upper(trim(coalesce(p_confirmation, ''))) <> 'ELIMINAR' then
    raise exception using errcode = '22023', message = 'Debes escribir ELIMINAR para confirmar';
  end if;

  select * into v_payment
    from public.payments
   where id = p_payment_id
     and validation_status = 'approved'
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Solo se pueden eliminar comprobantes aprobados';
  end if;

  v_order_id := v_payment.order_id;

  select count(*) into v_payment_count
    from public.payment_transactions
   where order_id = v_order_id;

  select count(*) into v_reward_count
    from public.referral_rewards
   where source_order_id = v_order_id;

  select count(*) into v_wallet_count
    from public.referral_wallet_entries
   where order_id = v_order_id;

  if v_payment_count > 0 or v_reward_count > 0 or v_wallet_count > 0 then
    raise exception using
      errcode = '23514',
      message = 'El pedido tiene dependencias de TropiPay o referidos y no puede eliminarse automaticamente';
  end if;

  -- Se elimina cualquier comprobante manual asociado porque la orden completa
  -- deja de existir, no solo el comprobante desde el que se inició la acción.
  delete from public.payments where order_id = v_order_id;
  delete from public.orders where id = v_order_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'No se encontro el pedido asociado';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'payment_id', v_payment.id,
    'order_id', v_order_id,
    'image_url', v_payment.image_url,
    'order_deleted', true
  );
end;
$$;

revoke all on function public.delete_approved_payment_and_order(uuid, text) from public;
grant execute on function public.delete_approved_payment_and_order(uuid, text) to service_role;
