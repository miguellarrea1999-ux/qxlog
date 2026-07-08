-- QxLog — create the private Storage bucket for radiology images.
--
-- WHY: X-ray images used to be stored as huge base64 strings inside the
-- `cirugias` table, which bloated every row and made the app re-download every
-- image on each load. Images now live in a Storage bucket; the table keeps only
-- a short file path. The bucket is PRIVATE — images are served via short-lived
-- signed URLs, so they are only viewable by your logged-in account.
--
-- HOW TO RUN: Supabase dashboard → SQL Editor → paste this → Run.
-- (Run the RLS script `enable-rls.sql` first if you haven't.)

-- 1. Create a private bucket named `rx`. `public = false` means objects are not
--    served over public URLs — only signed URLs or authenticated requests work.
insert into storage.buckets (id, name, public)
values ('rx', 'rx', false)
on conflict (id) do nothing;

-- 2. Allow any authenticated (logged-in) user to read/write objects in `rx`.
--    Single-user app, so that's just you. Anonymous requests match no policy
--    and are denied.
drop policy if exists "rx_authenticated_all" on storage.objects;
create policy "rx_authenticated_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'rx')
  with check (bucket_id = 'rx');
