-- Vincula la evidencia de entrega con la transacción TropiPay que liquidó la orden.
alter table public.delivery_confirmations
  add column if not exists payment_transaction_id uuid
    references public.payment_transactions(id) on delete set null;

create index if not exists delivery_confirmations_payment_transaction_idx
  on public.delivery_confirmations(payment_transaction_id);

create unique index if not exists delivery_confirmations_payment_transaction_uidx
  on public.delivery_confirmations(payment_transaction_id)
  where payment_transaction_id is not null;

-- La evidencia se sirve exclusivamente mediante URLs firmadas desde el backend.
insert into storage.buckets (id, name, public)
values ('delivery-confirmations', 'delivery-confirmations', false)
on conflict (id) do update set public = false;

alter table public.delivery_confirmations enable row level security;

drop policy if exists delivery_confirmations_no_direct_access on public.delivery_confirmations;
create policy delivery_confirmations_no_direct_access
  on public.delivery_confirmations
  for all to anon, authenticated
  using (false)
  with check (false);
