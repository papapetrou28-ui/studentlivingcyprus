# Supabase integration — development branch

This branch prepares a Supabase schema and browser API module. **It is not connected to the existing UI yet.** The live demo remains unchanged.

## Setup
1. In Supabase SQL Editor, run `supabase/schema.sql` in a new project. This creates tables and RLS policies.
2. In Authentication > Providers, enable email and keep email confirmation enabled.
3. In Authentication > URL Configuration, set the Site URL to your Netlify domain and add allowed redirect URLs for your development preview.
4. Set the Supabase project URL and **publishable/anon key** in a local configuration script before importing `src/supabase.js`:
   `window.SLC_SUPABASE_CONFIG = { url: 'https://YOUR_PROJECT.supabase.co', publishableKey: 'YOUR_PUBLIC_KEY' };`
5. Never commit a service_role key, database password, or other secrets. Public keys are intended for browser use, secured by RLS.
6. Integrate the exported functions into forms on `index.html`. Do not deploy this as complete authentication until the UI and end-to-end tests are finished.

## Security notes
- Newly submitted properties stay `pending`; publication needs a trusted admin workflow.
- The role is selected on signup and should **not** be treated as proof of landlord verification.
- No payment handling, storage uploads, moderation panel or admin tooling is implemented.
- This is a starter schema intended for a fresh Supabase project; existing policies may need migrations rather than re-running.
