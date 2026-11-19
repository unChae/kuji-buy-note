create function public.save_product_receipts(
  target_product_id text,
  expected_receipts jsonb,
  updated_receipts jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_receipts jsonb;
begin
  if public.is_admin() is distinct from true then
    raise insufficient_privilege;
  end if;

  if jsonb_typeof(updated_receipts) is distinct from 'object' then
    raise invalid_parameter_value;
  end if;

  perform 1 from public.display_products
  where id = target_product_id
  for no key update;
  if not found then
    raise no_data_found;
  end if;

  select coalesce(jsonb_object_agg(supplier, quantity), '{}'::jsonb)
  into current_receipts
  from public.product_receipts
  where product_id = target_product_id;

  if current_receipts is distinct from expected_receipts then
    raise exception 'product_receipts_changed' using errcode = '40001';
  end if;

  delete from public.product_receipts
  where product_id = target_product_id
    and not (updated_receipts ? supplier);

  insert into public.product_receipts (product_id, supplier, quantity)
  select target_product_id, entry.key, entry.value::integer
  from jsonb_each(updated_receipts) as entry
  where (current_receipts -> entry.key) is distinct from entry.value
  on conflict (product_id, supplier) do update set quantity = excluded.quantity;
end;
$$;

revoke all on function public.save_product_receipts(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_product_receipts(text, jsonb, jsonb) to authenticated;
