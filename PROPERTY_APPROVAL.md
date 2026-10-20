# Property approval and testing

## Current behavior
- A signed-in **landlord** can submit a property. It is inserted with status `pending`.
- Public visitors see only `published` properties.
- A landlord sees their own pending and published submissions in My dashboard.
- A landlord may delete their own submission. Editing and photos are not yet implemented.
- The contact email entered in the original form is **not stored** in this first release. Do not promise that tenants can contact landlords yet.
- The roommate board still uses demo browser storage.

## Approving properties manually (temporary admin workflow)
Until a dedicated admin dashboard exists, only the project owner should approve a listing from the Supabase SQL Editor. **Never** expose a service-role key to the browser.

1. Open Supabase > SQL Editor and inspect pending submissions:

```sql
select id, owner_id, title, area, rent, status, created_at
from public.properties
where status = 'pending'
order by created_at desc;
```

2. Independently verify the listing and the landlord. Copy the specific UUID for the listing you intend to approve.
3. In SQL Editor, run this statement after replacing the UUID placeholder with the actual ID:

```sql
update public.properties
set status = 'published'
where id = 'REPLACE_WITH_PROPERTY_UUID'::uuid and status = 'pending'
returning id, title, status;
```

The SQL Editor runs with elevated database privileges. Only trusted project administrators should use it. Do not use the frontend publishable key to approve listings.

## Important setup / test
- Run `supabase/schema.sql` in your Supabase project if not already done.
- If the original schema was already run, apply `supabase/fix_profile_role_policy.sql` (previously completed).
- Visit the Netlify **branch preview**, not the live website. Sign in as landlord, submit a listing, verify `pending` in Supabase, and confirm it is **not** visible publicly.
- Approve one verified test listing with the SQL statement above, refresh the preview and confirm it appears publicly.
- Sign in as a student and verify student accounts cannot submit a property.
- The site has not been fully tested, and approval is manual. Do not merge to production until testing and moderation requirements are complete.
