-- SAN WEALTH AI: accounts, subscriptions, AI wallet.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- All tables are locked (RLS on, no policies). Only the app's server (service role) can use them.

create table if not exists public.plans (
  id text primary key,
  name text not null,
  price_inr integer not null check (price_inr > 0),
  ai boolean not null default false,
  voice boolean not null default false,
  sort integer not null default 0,
  active boolean not null default true
);

create table if not exists public.wallet_packs (
  id text primary key,
  price_inr integer not null check (price_inr > 0),
  credit_micro bigint not null check (credit_micro > 0),   -- 1,000,000 = US$1.00 of AI credit
  sort integer not null default 0,
  active boolean not null default true
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text not null,
  city text not null,
  business text not null,
  purpose text not null,
  monthly_income numeric,
  monthly_expense numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text references public.plans(id),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_micro bigint not null default 0,
  low_notified boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta_micro bigint not null,
  reason text not null,
  ref text unique,
  balance_after bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists wallet_ledger_user_idx on public.wallet_ledger (user_id, created_at desc);

create table if not exists public.orders (
  provider_order_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('plan', 'pack')),
  item_id text not null,
  amount_inr integer not null,
  status text not null default 'created',
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  provider text not null,
  provider_payment_id text not null,
  provider_order_id text,
  user_id uuid not null,
  kind text not null,
  item_id text not null,
  amount_inr integer not null,
  created_at timestamptz not null default now(),
  primary key (provider, provider_payment_id)
);

alter table public.plans enable row level security;
alter table public.wallet_packs enable row level security;
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;

-- Add or subtract AI credit. Safe to retry: the same ref is applied only once.
create or replace function public.wallet_apply(
  p_user uuid, p_delta bigint, p_reason text, p_ref text, p_low bigint default 1000000
) returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.wallets; nb bigint; crossed boolean;
begin
  insert into wallets (user_id) values (p_user) on conflict do nothing;
  select * into w from wallets where user_id = p_user for update;
  if p_ref is not null and exists (select 1 from wallet_ledger where ref = p_ref) then
    return jsonb_build_object('status', 'duplicate', 'balance_micro', w.balance_micro, 'crossed_low', false);
  end if;
  nb := w.balance_micro + p_delta;
  crossed := (p_delta < 0 and nb < p_low and not w.low_notified);
  insert into wallet_ledger (user_id, delta_micro, reason, ref, balance_after)
    values (p_user, p_delta, p_reason, p_ref, nb);
  update wallets set
    balance_micro = nb,
    low_notified = case
      when p_delta > 0 and nb >= p_low then false
      when p_delta < 0 and nb < p_low then true
      else low_notified end,
    updated_at = now()
  where user_id = p_user;
  return jsonb_build_object('status', 'ok', 'balance_micro', nb, 'crossed_low', crossed);
end $$;

-- A verified payment: adds 30 days to the plan, or credit to the wallet. Safe to retry.
create or replace function public.apply_payment(
  p_provider text, p_payment_id text, p_order_id text, p_amount_inr integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders; v_exp timestamptz; pk public.wallet_packs;
begin
  select * into o from orders where provider_order_id = p_order_id for update;
  if not found then return jsonb_build_object('status', 'unknown_order'); end if;
  if p_amount_inr is not null and p_amount_inr <> o.amount_inr then
    return jsonb_build_object('status', 'amount_mismatch');
  end if;
  insert into payments (provider, provider_payment_id, provider_order_id, user_id, kind, item_id, amount_inr)
    values (p_provider, p_payment_id, p_order_id, o.user_id, o.kind, o.item_id, o.amount_inr)
    on conflict do nothing;
  if not found then return jsonb_build_object('status', 'duplicate'); end if;
  update orders set status = 'paid' where provider_order_id = p_order_id;
  if o.kind = 'plan' then
    v_exp := greatest(coalesce((select expires_at from subscriptions where user_id = o.user_id), now()), now())
             + interval '30 days';
    insert into subscriptions (user_id, plan_id, expires_at) values (o.user_id, o.item_id, v_exp)
      on conflict (user_id) do update set plan_id = excluded.plan_id, expires_at = excluded.expires_at, updated_at = now();
  else
    select * into pk from wallet_packs where id = o.item_id;
    perform public.wallet_apply(o.user_id, pk.credit_micro, 'recharge', 'pay:' || p_provider || ':' || p_payment_id);
  end if;
  return jsonb_build_object('status', 'applied', 'kind', o.kind, 'user_id', o.user_id);
end $$;

-- Everything the app needs to know about one account.
create or replace function public.account_state(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) - 'id' from profiles p where p.id = p_user),
    'plan_id', s.plan_id,
    'plan', (select to_jsonb(pl) from plans pl where pl.id = s.plan_id),
    'expires_at', s.expires_at,
    'active', coalesce(s.expires_at > now(), false),
    'balance_micro', coalesce(w.balance_micro, 0))
  from (select 1) x
  left join subscriptions s on s.user_id = p_user
  left join wallets w on w.user_id = p_user;
$$;

-- These helpers must never be callable from the public API.
revoke all on function public.wallet_apply(uuid, bigint, text, text, bigint) from public, anon, authenticated;
revoke all on function public.apply_payment(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.account_state(uuid) from public, anon, authenticated;
grant execute on function public.wallet_apply(uuid, bigint, text, text, bigint) to service_role;
grant execute on function public.apply_payment(text, text, text, integer) to service_role;
grant execute on function public.account_state(uuid) to service_role;

-- Starter plans and wallet packs. PLACEHOLDER PRICES: edit these rows to your real prices
-- (Table Editor -> plans / wallet_packs), no code change needed.
insert into public.plans (id, name, price_inr, ai, voice, sort) values
  ('basic',   'Basic',         199, false, false, 1),
  ('premium', 'Premium',       499, true,  false, 2),
  ('super',   'Super Premium', 999, true,  true,  3)
on conflict (id) do nothing;

insert into public.wallet_packs (id, price_inr, credit_micro, sort) values
  ('p100', 100, 1000000, 1),
  ('p300', 300, 3500000, 2),
  ('p500', 500, 6000000, 3)
on conflict (id) do nothing;
