-- Datos de facturación del cliente para TropiPay, recogidos en el registro para no
-- pedirlos en cada pago. Deben coincidir con los de la tarjeta (TropiPay los valida).
-- Columnas nulas y sin default: el ALTER solo toca el catálogo, no reescribe la tabla.
alter table public.customer_profiles
  add column if not exists pais_iso text,
  add column if not exists direccion_facturacion text,
  add column if not exists ciudad text,
  add column if not exists estado_region text,
  add column if not exists codigo_postal text,
  add column if not exists fecha_nacimiento date,
  add column if not exists terminos_tropipay_at timestamptz;

alter table public.customer_profiles
  drop constraint if exists customer_profiles_pais_iso_check;
alter table public.customer_profiles
  add constraint customer_profiles_pais_iso_check check (pais_iso is null or pais_iso ~ '^[A-Z]{2}$');
