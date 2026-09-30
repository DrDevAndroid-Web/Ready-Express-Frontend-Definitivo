-- Evita re-procesar el mismo evento TropiPay en entregas repetidas.
alter table public.payment_events
  add column if not exists idempotency_key text;

create unique index if not exists payment_events_idempotency_uidx
  on public.payment_events(idempotency_key)
  where idempotency_key is not null;
