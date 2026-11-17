-- Collected product details are independent of the store's incoming selection.
create table if not exists public.catalog_products (
  id text primary key,
  catalog_year integer not null check (catalog_year between 2000 and 2100),
  catalog_month integer not null check (catalog_month between 1 and 12),
  product jsonb not null check (jsonb_typeof(product) = 'object' and product->>'id' = id),
  updated_at timestamptz not null default now()
);
create index if not exists catalog_products_month on public.catalog_products (catalog_year, catalog_month);
alter table public.catalog_products enable row level security;
grant select on public.catalog_products to anon, authenticated;
grant insert, update on public.catalog_products to authenticated;
drop policy if exists "Anyone can read catalog" on public.catalog_products;
create policy "Anyone can read catalog" on public.catalog_products for select to anon, authenticated using (true);
drop policy if exists "Admins can insert catalog" on public.catalog_products;
create policy "Admins can insert catalog" on public.catalog_products for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins can update catalog" on public.catalog_products;
create policy "Admins can update catalog" on public.catalog_products for update to authenticated using (public.is_admin()) with check (public.is_admin());
