-- Nombre y apellidos del remitente por separado (todos los métodos de pago)
-- y datos del pagador que exige TropiPay (objeto `client` de /api/v3/paymentcards).
-- sender_name se sigue guardando con el nombre completo por compatibilidad
-- con la APK, los PDF y los emails.

alter table public.orders add column if not exists sender_first_name text;
alter table public.orders add column if not exists sender_last_name text;

-- { country_iso, address, city, state, post_code, terms_accepted_at }
alter table public.orders add column if not exists payer_details jsonb;

comment on column public.orders.payer_details is
  'Datos del pagador para TropiPay: country_iso (ISO 3166-1 alpha-2), address, city, state, post_code, terms_accepted_at';
