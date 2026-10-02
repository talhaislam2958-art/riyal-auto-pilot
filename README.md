# Riyal Auto Accept

Build a sellable web app called "Order Auto-Accept Board" for the merchant site https://customer.riyalen.com (Saudi Arabia). Buyers log in with their own account on that site; the board polls for orders and auto-accepts only orders that match their filters. I (the admin) sell access, and a user can only run the bot after I approve them. Use Lovable Cloud / Supabase for database, auth and edge functions.



=== 1. ARCHITECTURE ===

- Browser calls to customer.riyalen.com are blocked by CORS, so ALL upstream calls go through Supabase Edge Functions (a backend proxy). The frontend talks only to the edge functions; the edge functions forward requests to the upstream API and return the response.

- Never hardcode any credentials or tokens. Each visitor logs in with their own riyalen account, so one shared link works for everyone.

- Do NOT store users' riyalen passwords anywhere. Store only the username. Keep the upstream token only in the browser (localStorage) and pass it per request.



=== 2. UPSTREAM APIs (base https://customer.riyalen.com) ===

1. Login: POST /api/merchant/login, JSON {"username":"...","password":"..."} -> returns a token.

2. Profile: POST /api/merchant/profile, JSON {"token":"..."}

3. Announcement: GET /api/merchant/announcement?t=<timestamp ms>

4. Orders list (polling): GET /api/merchant/orders/fast?limit=20&token=<token>&t=<timestamp ms>

5. Accept order: POST /api/merchant/orders/accept, JSON {"token":"...","order_no":"<order number>"}

6. Withdraw history: POST /api/merchant/withdraw-history, JSON {"token":"..."}

Send headers: Content-Type: application/json, Accept: */*, Origin and Referer: https://customer.riyalen.com/home.html, and a mobile Chrome User-Agent.

I have not seen the exact orders response format yet, so build the parser flexibly (find order number, amount, payment method fields) and include a debug panel that shows the raw JSON of the orders response, so field names can be mapped later.



=== 3. ROUTES ===

- "/" = User Panel (the link I send to buyers).

- "/admin" = Admin Panel (only for me). Protect it with Supabase Auth email+password login and an admin role stored in a separate user_roles table (never on the client, never in localStorage). Only my account is admin.



=== 4. DATABASE ===

Table bot_users: id, riyalen_username (unique), status ('pending' | 'approved' | 'blocked'), expires_at (nullable), notes, created_at, last_seen_at, accepted_count.

Table app_settings: admin_contact_text, admin_contact_link (WhatsApp/Telegram).

When a buyer logs in successfully for the first time, create a bot_users row with status 'pending'.

Row Level Security on all tables: only admin can read/write from the client; edge functions use the service role.



=== 5. ENFORCEMENT (CRITICAL, SERVER SIDE) ===

- Every accept call goes through the edge function. Before forwarding it to upstream, the edge function must check bot_users for that username: status = 'approved' AND (expires_at is null OR expires_at > now()). If not, return 403 {"error":"not_approved"} and do NOT call upstream. This check must exist in the backend, not just in the UI.

- The edge function must verify the username from the token by calling the upstream profile API (do not trust a username sent by the client).

- Unapproved users may log in and see the panel, but the bot cannot accept any order, even if they tamper with the frontend.



=== 6. USER PANEL ===

- Login screen (username/password) -> Dashboard. Logout button. If the token expires (auth error), stop polling and ask to log in again.

- On login and every 60 seconds, fetch the user's status from the backend.

- If pending / blocked / expired: show a clear banner "Bot is currently off. Contact your admin to activate." with the admin contact link from app_settings, and disable the Start button.

- If approved: enable the bot. Stop immediately if the admin revokes access.

- Start/Stop button. Polling interval: user-adjustable number input, minimum 10 seconds (enforce), saved in localStorage.

- Filters (saved in localStorage):

  - Payment methods: multi-select checkboxes: STC Pay, Barq, Urpay, Bank transfer (various banks), plus an "add custom method" field. Only orders with a selected method are accepted.

  - Amount: Min and Max inputs. Only orders inside [min, max] are accepted.

- Logic per poll: fetch orders -> for each new order (track seen order_no to avoid duplicates) -> check payment method AND amount against the filters -> if matched, call accept; otherwise mark "Skipped" with the reason (method mismatch / amount out of range).

- Live log table: time, order no, amount, method, result (Accepted / Skipped / Failed + reason). Counters for accepted, skipped, failed. Optional sound alert on accept. Show the announcement text at the top.

- Polling runs while the browser tab is open. Handle errors, rate limits and network failures gracefully (retry on the next interval, no crash).



=== 7. ADMIN PANEL ===

- Table of all users: username, status, expires_at, last seen, accepted count, notes.

- Per-user actions: Approve, Block, Set/extend expiry (e.g. +30 days), Edit notes, Delete.

- Search and filter by status. Counters: total, pending, approved, blocked.

- Settings section to edit admin contact text and link shown in the user panel.



=== 8. SECURITY & UI ===

- No secrets or tokens in logs. Rate-limit the login and accept edge functions.

- Mobile-first, clean dark UI, English labels.

=== 9. BUILD INSTRUCTIONS ===

Build everything described above in one go. Do not ask me clarifying questions; make reasonable assumptions. Do not add extra features beyond what is listed. Keep the code simple and working.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://riyal-auto-pilot.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/55bfae57-d660-4064-8539-8c7b50e20fd2).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
