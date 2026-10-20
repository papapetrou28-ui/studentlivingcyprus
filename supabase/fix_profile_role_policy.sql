-- Run in Supabase SQL Editor if you already ran the first schema.sql version.
-- Prevent users from changing their own account role via the browser.
drop policy if exists "Users update own profile" on public.profiles;
-- Profiles can still be created by their owners; subsequent role changes require trusted admin tooling.
