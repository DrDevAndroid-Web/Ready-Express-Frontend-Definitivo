-- Ficha de producto para electrodomésticos: texto libre y características ordenadas.
-- caracteristicas es un array [{ "nombre": "Marca", "valor": "LG" }, ...] (no un objeto:
-- jsonb reordena las claves y se perdería el orden que elige el administrador).
alter table public."Electrodomesticos"
  add column if not exists descripcion text,
  add column if not exists caracteristicas jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'electrodomesticos_caracteristicas_array'
      and conrelid = 'public."Electrodomesticos"'::regclass
  ) then
    alter table public."Electrodomesticos"
      add constraint electrodomesticos_caracteristicas_array
      check (jsonb_typeof(caracteristicas) = 'array');
  end if;
end $$;
