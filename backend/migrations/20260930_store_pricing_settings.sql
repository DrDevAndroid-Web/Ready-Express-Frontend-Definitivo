-- Recargo de precios de la tienda: cubre las comisiones de cobro (TropiPay) y de mover
-- el dinero. Se configura desde la APK de administración y se aplica a todos los precios
-- públicos (productos y entrega), igual para todos los métodos de pago.
-- Una sola fila (id = 1). Sin políticas RLS: solo el backend (service_role) la lee y escribe.
create table if not exists public.configuracion_precios (
  id smallint primary key default 1 check (id = 1),
  recargo_porcentaje numeric(5,2) not null default 0
    check (recargo_porcentaje >= 0 and recargo_porcentaje <= 50),
  redondeo text not null default 'centimos_99'
    check (redondeo in ('ninguno', 'centimos_99', 'entero')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.configuracion_precios (id) values (1) on conflict (id) do nothing;

alter table public.configuracion_precios enable row level security;
