-- NexTrade — Supabase schema for persistent user storage
-- Run this once in the Supabase project's SQL Editor (https://app.supabase.com -> your project -> SQL Editor -> New query)

create table if not exists public.users (
  id         bigint generated always as identity primary key,
  username   text not null unique,
  email      text not null unique,
  hash       text not null,
  role       text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

-- Onboarding preferences: usage mode ('signals' | 'analysis') + weekly-signals email opt-in.
-- Safe to re-run — adds the columns only if they don't already exist.
alter table public.users add column if not exists mode text;
alter table public.users add column if not exists email_alerts boolean not null default true;

-- Monetization / plan columns (3 tiers: free(=Basic) | gold | premium, with a 7-day premium trial).
--   plan          : 'free' | 'gold' | 'premium'
--   premium_until : when premium access expires (trial end or paid-period end)
--   trial_used    : whether the one-time 7-day trial was already granted
--   stripe_customer : Stripe customer id, for managing the subscription
alter table public.users add column if not exists plan text not null default 'free';
alter table public.users add column if not exists premium_until timestamptz;
alter table public.users add column if not exists trial_used boolean not null default false;
alter table public.users add column if not exists stripe_customer text;

-- Server uses the Service Role key (bypasses RLS), so RLS can stay enabled with no public policies.
alter table public.users enable row level security;

-- Per-user watchlist — keeps the symbol list in sync across the website and the installed PWA.
create table if not exists public.watchlists (
  user_id    bigint primary key references public.users(id) on delete cascade,
  symbols    jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.watchlists enable row level security;

-- Server-generated trading signals (authoritative feed). The server scanner writes
-- here; GET /api/signals serves them gated by plan. Durable across restarts.
--   key     : dedupe key, one per symbol/direction/day (e.g. buy_TEVA.TA_Fri Oct 18 2026)
--   ts      : unix ms when the signal fired (used for the free-tier delay window)
--   payload : the full signal object the client renders
create table if not exists public.signals (
  key        text primary key,
  ts         bigint not null,
  sym        text,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists signals_ts_idx on public.signals (ts desc);

alter table public.signals enable row level security;

-- AI stock analysis usage: which symbols a user analysed on a given day (Asia/Jerusalem date).
-- Powers the daily quota (Basic 3/day, Gold 15/day, Premium unlimited). Re-analysing a
-- symbol already in `syms` the same day does not consume another credit.
create table if not exists public.analysis_usage (
  user_id    bigint not null references public.users(id) on delete cascade,
  day        text   not null,
  syms       jsonb  not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.analysis_usage enable row level security;


