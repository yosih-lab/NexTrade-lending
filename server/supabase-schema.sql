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

-- Monetization / plan columns (Freemium: free | premium, with a 7-day trial).
--   plan          : 'free' | 'premium'
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

