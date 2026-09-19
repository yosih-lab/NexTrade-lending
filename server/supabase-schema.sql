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

-- Server uses the Service Role key (bypasses RLS), so RLS can stay enabled with no public policies.
alter table public.users enable row level security;
