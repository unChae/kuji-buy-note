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
