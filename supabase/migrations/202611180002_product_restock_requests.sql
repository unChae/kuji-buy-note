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
