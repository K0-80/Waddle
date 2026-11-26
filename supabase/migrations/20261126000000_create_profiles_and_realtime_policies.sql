create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null
    constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  settings jsonb not null default '{}'::jsonb
    constraint profiles_settings_object check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now()
);

create unique index profiles_username_lower_unique
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (settings) on public.profiles to authenticated;

create policy "Users can read their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update their own settings"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text := new.raw_user_meta_data ->> 'username';
begin
  if requested_username is null
    or requested_username !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Username must be 3-20 letters, numbers, or underscores';
  end if;

  insert into public.profiles (id, username)
  values (new.id, requested_username);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

create policy "Authenticated users can receive Waddle realtime messages"
  on realtime.messages
  for select
  to authenticated
  using (
    (select realtime.topic()) = 'waddle:global'
    and extension in ('broadcast', 'presence')
  );

create policy "Authenticated users can send Waddle realtime messages"
  on realtime.messages
  for insert
  to authenticated
  with check (
    (select realtime.topic()) = 'waddle:global'
    and extension in ('broadcast', 'presence')
  );
