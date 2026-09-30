-- Apply after 202609260001_theibs_access.sql. Payments remain disabled until
-- this migration is applied and verified in the intended Supabase project.
create table if not exists public.theibs_billing_environment (
  singleton boolean primary key default true check (singleton),
  environment text not null check (environment in ('development','production'))
);
insert into public.theibs_billing_environment(singleton, environment)
  values (true, 'production') on conflict (singleton) do nothing;
alter table public.theibs_billing_environment enable row level security;
revoke all on table public.theibs_billing_environment from anon, authenticated;
grant select, update on table public.theibs_billing_environment to service_role;

create table if not exists public.theibs_payment_orders (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  environment text not null check (environment in ('development', 'production')),
  method text not null check (method in ('PIX', 'CARD')),
  status text not null check (status in ('CREATING','PENDING','PAID','EXPIRED','CANCELLED','REFUNDED','DISPUTED','FAILED')),
  provider_charge_id text unique,
  provider_url text,
  pix_br_code text,
  pix_qr_base64 text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists theibs_one_open_payment_order
  on public.theibs_payment_orders(user_id, product_id, environment)
  where status in ('CREATING','PENDING','PAID');
create index if not exists theibs_payment_orders_user_created
  on public.theibs_payment_orders(user_id, created_at desc);

alter table public.theibs_payment_orders enable row level security;
revoke all on table public.theibs_payment_orders from anon, authenticated;
grant select, insert, update on table public.theibs_payment_orders to service_role;

-- Called only by the server with a Supabase secret key. A row lock and the
-- unique event ID make event recording, order transition, and access atomic.
create or replace function public.theibs_apply_payment_event(
  p_order_id uuid,
  p_event_id text,
  p_event_type text,
  p_status text,
  p_provider_charge_id text,
  p_payload jsonb
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_order public.theibs_payment_orders%rowtype;
  v_inserted integer;
begin
  if p_event_id is null or length(p_event_id) < 4 or
     p_status not in ('PAID','REFUNDED','DISPUTED','EXPIRED','CANCELLED','FAILED') then
    raise exception 'Invalid payment event';
  end if;
  select * into v_order from public.theibs_payment_orders
    where id = p_order_id for update;
  if not found or v_order.provider_charge_id is distinct from p_provider_charge_id then
    raise exception 'Payment order does not match';
  end if;
  if not exists (select 1 from public.theibs_billing_environment
                   where singleton = true and environment = v_order.environment) then
    raise exception 'Payment environment does not match database';
  end if;
  insert into public.theibs_payment_events(event_id, event_type, dev_mode, payload)
    values (p_event_id, p_event_type, v_order.environment = 'development', p_payload)
    on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return pg_catalog.jsonb_build_object('duplicate', true, 'status', v_order.status);
  end if;

  -- A delayed completion cannot restore a refunded/disputed order.
  if p_status = 'PAID' and v_order.status in ('REFUNDED','DISPUTED') then
    return pg_catalog.jsonb_build_object('duplicate', false, 'status', v_order.status);
  end if;
  update public.theibs_payment_orders
     set status = p_status, updated_at = pg_catalog.now()
   where id = p_order_id;

  if p_status = 'PAID' then
    insert into public.theibs_entitlements
      (user_id, status, access_kind, provider, provider_checkout_id, current_period_end, last_event_id, updated_at)
    values (v_order.user_id, 'PAID', 'PURCHASE', 'ABACATEPAY', p_provider_charge_id, null, p_event_id, pg_catalog.now())
    on conflict (user_id) do update
      set status = 'PAID', access_kind = 'PURCHASE', provider = 'ABACATEPAY',
          provider_checkout_id = excluded.provider_checkout_id, current_period_end = null,
          last_event_id = excluded.last_event_id, updated_at = pg_catalog.now()
      where public.theibs_entitlements.access_kind <> 'LIFETIME';
  elsif p_status in ('REFUNDED','DISPUTED') then
    update public.theibs_entitlements
       set status = 'SUSPENDED', last_event_id = p_event_id, updated_at = pg_catalog.now()
     where user_id = v_order.user_id and provider_checkout_id = p_provider_charge_id
       and access_kind <> 'LIFETIME';
  end if;
  return pg_catalog.jsonb_build_object('duplicate', false, 'status', p_status);
end
$$;

revoke all on function public.theibs_apply_payment_event(uuid,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.theibs_apply_payment_event(uuid,text,text,text,text,jsonb) to service_role;
