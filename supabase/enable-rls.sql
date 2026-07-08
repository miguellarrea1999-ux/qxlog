-- QxLog — lock down the `cirugias` table with Row-Level Security.
--
-- WHY: today the table is reachable with the public "anon" key, which is shipped
-- in the browser bundle. Anyone with that key can read/edit/delete every patient
-- record. This script blocks the anon role entirely and allows access only to a
-- logged-in (authenticated) user. QxLog is single-user, so "must be logged in"
-- is enough — no per-row user_id is required.
--
-- HOW TO RUN: Supabase dashboard → SQL Editor → paste this → Run.
-- Do this AFTER you have created your login user (Authentication → Users → Add user),
-- and rotate the anon key afterwards (Project Settings → API → Rotate).

-- 1. Turn on RLS. With RLS on and no permissive policy, ALL access is denied by
--    default — including the anon key. This is the line that actually secures data.
alter table public.cirugias enable row level security;

-- 2. Allow any authenticated user full access. (Single-user app: the only
--    authenticated user is you.) The anon role matches no policy, so it stays blocked.
drop policy if exists "authenticated_full_access" on public.cirugias;
create policy "authenticated_full_access"
  on public.cirugias
  for all
  to authenticated
  using (true)
  with check (true);

-- 3. Make follow_ups default to an empty array so reads never see NULL
--    (matches how the app writes new rows). Safe to run repeatedly.
alter table public.cirugias
  alter column follow_ups set default '[]'::jsonb;

-- OPTIONAL — if you later want multi-device certainty that only YOU can read rows,
-- scope by owner instead of "any authenticated user":
--
--   alter table public.cirugias add column if not exists user_id uuid;
--   update public.cirugias set user_id = 'YOUR-AUTH-UID' where user_id is null;
--   alter table public.cirugias alter column user_id set default auth.uid();
--   drop policy if exists "authenticated_full_access" on public.cirugias;
--   create policy "owner_only" on public.cirugias for all to authenticated
--     using (user_id = auth.uid()) with check (user_id = auth.uid());
--
-- (Find YOUR-AUTH-UID in Authentication → Users after creating your account.)
