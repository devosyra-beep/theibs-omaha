create table if not exists public.theibs_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'NONE' check (status in ('NONE','TRIAL','ACTIVE','PAID','CANCELLED','SUSPENDED','REFUNDED')),
  access_kind text not null default 'PURCHASE' check (access_kind in ('PURCHASE','LIFETIME')),
  provider text,
  provider_subscription_id text,
  provider_checkout_id text,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  last_event_id text,
  updated_at timestamptz not null default now()
);

create table if not exists public.theibs_payment_events (
  event_id text primary key,
  event_type text not null,
  dev_mode boolean not null default false,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

alter table public.theibs_entitlements enable row level security;
alter table public.theibs_payment_events enable row level security;

revoke all on table public.theibs_entitlements from anon, authenticated;
grant select on table public.theibs_entitlements to authenticated;
grant all on table public.theibs_entitlements to service_role;
revoke all on table public.theibs_payment_events from anon, authenticated;
grant all on table public.theibs_payment_events to service_role;

drop policy if exists "users_read_own_theibs_entitlement" on public.theibs_entitlements;
create policy "users_read_own_theibs_entitlement"
  on public.theibs_entitlements for select to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.theibs_entitlements is 'Acesso ao THEIBS. Escrita exclusiva do backend; leitura somente pelo próprio usuário.';
comment on table public.theibs_payment_events is 'Log idempotente de webhooks AbacatePay. Sem acesso pelo navegador.';
