-- FORMA leaderboard for Supabase.  Run ONCE:  Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- This is the "Row Level Security" of the leaderboard:
--   * everybody can READ the leaderboard (even visitors who are not signed in),
--   * a browser can only create / update / delete ITS OWN row (row id = its Supabase user id),
--   * every column is length / range checked, so nobody can push junk or a score outside 0-7.

create table if not exists public.leaderboard (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name       text  not null check (char_length(name) between 2 and 24),
  bio        text  not null default '' check (char_length(bio) <= 140),
  soc        jsonb not null default '{}'::jsonb check (jsonb_typeof(soc) = 'object'    and pg_column_size(soc)    < 2000),
  score      real  not null check (score >= 0 and score < 7),
  scores     jsonb not null default '{}'::jsonb check (jsonb_typeof(scores) = 'object' and pg_column_size(scores) < 2000),
  avatar     text  not null default '' check (char_length(avatar) < 12000),
  updated_at timestamptz not null default now()
);

create index if not exists leaderboard_score_idx on public.leaderboard (score desc);

create or replace function public.leaderboard_touch() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists leaderboard_touch on public.leaderboard;
create trigger leaderboard_touch before insert or update on public.leaderboard
  for each row execute function public.leaderboard_touch();

alter table public.leaderboard enable row level security;

drop policy if exists "leaderboard: read all"   on public.leaderboard;
drop policy if exists "leaderboard: insert own" on public.leaderboard;
drop policy if exists "leaderboard: update own" on public.leaderboard;
drop policy if exists "leaderboard: delete own" on public.leaderboard;

create policy "leaderboard: read all"   on public.leaderboard for select to anon, authenticated using (true);
create policy "leaderboard: insert own" on public.leaderboard for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "leaderboard: update own" on public.leaderboard for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "leaderboard: delete own" on public.leaderboard for delete to authenticated using ((select auth.uid()) = user_id);

grant select on public.leaderboard to anon, authenticated;
grant insert, update, delete on public.leaderboard to authenticated;

-- Do NOT forget (dashboard): Authentication -> Sign In / Providers -> turn ON "Allow anonymous sign-ins".
