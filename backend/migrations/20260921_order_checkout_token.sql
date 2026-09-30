alter table public.orders add column if not exists checkout_token text;
create unique index if not exists orders_checkout_token_uidx on public.orders(checkout_token) where checkout_token is not null;
