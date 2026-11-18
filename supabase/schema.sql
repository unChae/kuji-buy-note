create table if not exists public.display_products (
  id text primary key,
  product jsonb not null
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.display_products enable row level security;
alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

revoke all on public.admin_users from anon, authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.display_products to anon, authenticated;
grant insert, update, delete on public.display_products to authenticated;

drop policy if exists "Anyone can read display products" on public.display_products;
create policy "Anyone can read display products"
  on public.display_products for select
  to anon, authenticated
  using (true);

drop policy if exists "Admins can insert display products" on public.display_products;
create policy "Admins can insert display products"
  on public.display_products for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update display products" on public.display_products;
create policy "Admins can update display products"
  on public.display_products for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete display products" on public.display_products;
create policy "Admins can delete display products"
  on public.display_products for delete
  to authenticated
  using (public.is_admin());

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

create table if not exists public.product_restock_requests (
  product_id text primary key references public.display_products (id) on delete cascade,
  quantity integer not null check (quantity >= 0)
);

alter table public.product_restock_requests enable row level security;
revoke all on public.product_restock_requests from public, anon, authenticated;
grant select, insert, update on public.product_restock_requests to authenticated;

drop policy if exists "Admins can read restock requests" on public.product_restock_requests;
create policy "Admins can read restock requests" on public.product_restock_requests
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admins can insert restock requests" on public.product_restock_requests;
create policy "Admins can insert restock requests" on public.product_restock_requests
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists "Admins can update restock requests" on public.product_restock_requests;
create policy "Admins can update restock requests" on public.product_restock_requests
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create table if not exists public.product_receipts (
  product_id text not null references public.display_products (id) on delete cascade,
  supplier text not null check (supplier = btrim(supplier) and char_length(supplier) between 1 and 120),
  quantity integer not null check (quantity >= 0),
  primary key (product_id, supplier)
);

alter table public.product_receipts enable row level security;
revoke all on public.product_receipts from public, anon, authenticated;
grant select, insert, update on public.product_receipts to authenticated;

drop policy if exists "Admins can manage product receipts" on public.product_receipts;
create policy "Admins can manage product receipts" on public.product_receipts
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
