-- Amygdala — Supabase schema (PRD §5.8, §8).
--
-- Run this once in your Supabase project: Dashboard → SQL Editor → paste → Run.
-- It creates the only part of the data model that outlives a room: the account
-- record. Guests persist nothing server-side (their stats live in the browser),
-- so nothing here is needed to play — it only lights up when a guest converts
-- to an account.
--
-- Auth itself is handled by Supabase (email/OAuth); these tables hang off the
-- built-in auth.users table via the user's id.

-- ---------------------------------------------------------------------------
-- profiles — one row per account, created on sign-up.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nickname    text not null check (char_length(nickname) between 1 and 20),
  -- Lifetime score, not a wallet: chips are cosmetic/score only (PRD §2). This
  -- is net winnings across all hands, a stat — room stacks stay play-money.
  chips       integer not null default 0,
  wins        integer not null default 0,
  losses      integer not null default 0,
  pushes      integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- match_history — the last N hands, newest first (PRD §5.8).
-- ---------------------------------------------------------------------------
create table if not exists public.match_history (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  game        text not null default 'blackjack',
  room_code   text,
  result      text not null,          -- win | loss | push | bust | blackjack
  payout      integer not null,
  played_at   timestamptz not null default now()
);
create index if not exists match_history_user_time
  on public.match_history (user_id, played_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security — a player can only see and change their own rows.
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.match_history  enable row level security;

create policy "own profile: read"   on public.profiles
  for select using (auth.uid() = id);
create policy "own profile: write"  on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own history: read"   on public.match_history
  for select using (auth.uid() = user_id);
create policy "own history: write"  on public.match_history
  for insert with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Create a profile row automatically whenever an auth user is created.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nickname', 'player'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
