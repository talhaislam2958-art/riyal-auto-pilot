<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- All calls to the upstream merchant site go through TanStack server functions in `src/lib/riyalen.functions.ts` (browser CORS blocks direct calls); approval is enforced server-side before any accept is forwarded.
- Admin is a role in `user_roles`; the first account to call `claim_admin()` becomes the only admin. Admin panel uses RLS-guarded browser queries.
- Upstream tokens live only in browser localStorage; never store merchant passwords or log tokens.
- Self-hosting: the app reads Supabase only from env (browser: VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY; server: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY), so it can point at any Supabase project; Vercel builds need NITRO_PRESET=vercel because the default build preset targets Cloudflare.
