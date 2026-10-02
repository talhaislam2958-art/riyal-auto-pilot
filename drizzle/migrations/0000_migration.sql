create type public.app_role as enum ('admin', 'user');
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "Users read own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());

-- First signed-in account to call this becomes the only admin.
create or replace function public.claim_admin()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.user_roles where role = 'admin') then
    return public.has_role(auth.uid(), 'admin');
  end if;
  insert into public.user_roles(user_id, role) values (auth.uid(), 'admin');
  return true;
end $$;
revoke execute on function public.claim_admin() from anon, public;
grant execute on function public.claim_admin() to authenticated;

create table public.bot_users (
  id uuid primary key default gen_random_uuid(),
  riyalen_username text not null unique,
  status text not null default 'pending' check (status in ('pending','approved','blocked')),
  expires_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  accepted_count integer not null default 0
);
grant select, insert, update, delete on public.bot_users to authenticated;
grant all on public.bot_users to service_role;
alter table public.bot_users enable row level security;
create policy "Admin all bot_users" on public.bot_users for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create table public.app_settings (
  id integer primary key default 1 check (id = 1),
  admin_contact_text text not null default 'Contact admin on WhatsApp',
  admin_contact_link text not null default ''
);
insert into public.app_settings (id) values (1);
grant select, insert, update, delete on public.app_settings to authenticated;
grant all on public.app_settings to service_role;
alter table public.app_settings enable row level security;
create policy "Admin all app_settings" on public.app_settings for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);
grant all on public.rate_limits to service_role;
alter table public.rate_limits enable row level security;

create or replace function public.hit_rate_limit(_key text, _max integer, _window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.rate_limits;
begin
  insert into public.rate_limits(key, window_start, count) values (_key, now(), 0)
  on conflict (key) do nothing;
  select * into r from public.rate_limits where key = _key for update;
  if r.window_start < now() - make_interval(secs => _window_seconds) then
    update public.rate_limits set window_start = now(), count = 1 where key = _key;
    return true;
  end if;
  if r.count >= _max then return false; end if;
  update public.rate_limits set count = count + 1 where key = _key;
  return true;
end $$;
revoke execute on function public.hit_rate_limit(text, integer, integer) from anon, authenticated, public;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

create or replace function public.increment_accepted(_username text)
returns void language sql security definer set search_path = public as $$
  update public.bot_users set accepted_count = accepted_count + 1 where riyalen_username = _username;
$$;
revoke execute on function public.increment_accepted(text) from anon, authenticated, public;
grant execute on function public.increment_accepted(text) to service_role;