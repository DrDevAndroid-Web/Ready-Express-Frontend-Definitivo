-- Permite guardar el estado 'amount_mismatch' cuando TropiPay informa un importe
-- distinto al de la orden (tropipay.service.js lo intenta y hoy falla por el CHECK).
-- La restricción se creó inline, así que se busca por definición en vez de por nombre.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.payment_transactions'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.payment_transactions drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.payment_transactions
  add constraint payment_transactions_status_check
  check (status in ('pending', 'processing', 'successful', 'failed', 'cancelled', 'refunded', 'amount_mismatch'));
