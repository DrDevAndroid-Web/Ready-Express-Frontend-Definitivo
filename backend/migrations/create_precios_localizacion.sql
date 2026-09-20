-- Localizaciones de entrega y recargos administrables desde el backend.
create table if not exists public.precios_localizacion (
  id uuid primary key default gen_random_uuid(),
  municipio text not null,
  recargo numeric(10, 2) not null default 0 check (recargo >= 0),
  activo boolean not null default true,
  orden integer not null default 0,
  es_base boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists precios_localizacion_municipio_lower_idx
  on public.precios_localizacion (lower(municipio));

create unique index if not exists precios_localizacion_una_base_idx
  on public.precios_localizacion (es_base)
  where es_base = true;

alter table public.precios_localizacion enable row level security;
revoke all on table public.precios_localizacion from anon, authenticated;
grant all on table public.precios_localizacion to service_role;

create or replace function public.set_precios_localizacion_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists precios_localizacion_updated_at on public.precios_localizacion;
create trigger precios_localizacion_updated_at
before update on public.precios_localizacion
for each row execute function public.set_precios_localizacion_updated_at();

insert into public.precios_localizacion (municipio, recargo, activo, orden, es_base)
values ('Guantánamo', 0, true, 0, true)
on conflict do nothing;

alter table public.orders add column if not exists delivery_location_id uuid;
alter table public.orders add column if not exists delivery_municipality text;
alter table public.orders add column if not exists products_subtotal numeric(10, 2);
alter table public.orders add column if not exists delivery_surcharge numeric(10, 2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_delivery_location_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_delivery_location_id_fkey
      foreign key (delivery_location_id)
      references public.precios_localizacion(id)
      on delete set null;
  end if;
end;
$$;

-- Realtime observa la tabla; el backend retransmite solo un aviso de invalidacion.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'precios_localizacion'
  ) then
    alter publication supabase_realtime add table public.precios_localizacion;
  end if;
end;
$$;
