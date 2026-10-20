-- Run once in Supabase SQL Editor.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '',
 role text not null default 'student' check (role in ('student','landlord')),
 created_at timestamptz not null default now()
);
create table if not exists public.properties (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 title text not null check (char_length(title) between 3 and 120),
 type text not null check (type in ('Apartment','Studio','Room')),
 area text not null,
 rent numeric(10,2) not null check (rent > 0),
 beds integer not null default 0 check (beds >= 0),
 deposit numeric(10,2) not null default 0 check (deposit >= 0),
 bills numeric(10,2) not null default 0 check (bills >= 0),
 description text not null default '',
 status text not null default 'pending' check (status in ('pending','published','rejected')),
 created_at timestamptz not null default now()
);
create table if not exists public.roommate_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 name text not null,
 budget numeric(10,2) not null check (budget > 0),
 area text not null default '',
 about text not null default '',
 created_at timestamptz not null default now()
);
create index if not exists properties_owner_idx on public.properties(owner_id);
create index if not exists properties_status_idx on public.properties(status);
create index if not exists roommate_user_idx on public.roommate_requests(user_id);
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.roommate_requests enable row level security;
create policy "Users read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "Users create own profile" on public.profiles for insert to authenticated with check (id = (select auth.uid()) and role in ('student','landlord'));
create policy "Users update own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Public sees published properties" on public.properties for select to anon, authenticated using (status = 'published' or owner_id = (select auth.uid()));
create policy "Landlords create pending properties" on public.properties for insert to authenticated with check (
 owner_id = (select auth.uid()) and status = 'pending'
 and exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'landlord')
);
create policy "Owners update pending properties" on public.properties for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and status = 'pending');
create policy "Owners delete properties" on public.properties for delete to authenticated using (owner_id = (select auth.uid()));
create policy "Public reads roommate requests" on public.roommate_requests for select to anon, authenticated using (true);
create policy "Users create own roommate requests" on public.roommate_requests for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users edit own roommate requests" on public.roommate_requests for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Users delete own roommate requests" on public.roommate_requests for delete to authenticated using (user_id = (select auth.uid()));
-- IMPORTANT: property publication requires a trusted admin/service-side workflow.
-- Never put a service_role key in frontend JavaScript.
