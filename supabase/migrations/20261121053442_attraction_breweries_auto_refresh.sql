-- Rebuild attraction_breweries (and has_pseo_page) automatically when breweries change.
-- A statement-level trigger on breweries marks the data dirty when a brewery is added, removed or
-- moved; a pg_cron job every 30 minutes runs refresh_attraction_breweries() only when it is dirty.
-- Catches every writer (the sync, scripts, the dashboard) without exposing the refresh to the API.
-- After editing maryland_attraction_overrides, still run the refresh by hand (or set dirty).

create extension if not exists pg_cron;

create table if not exists public.attraction_refresh_state (
  id                boolean primary key default true check (id),  -- one row
  dirty             boolean not null default false,
  last_refreshed_at timestamptz
);
insert into public.attraction_refresh_state (id, dirty, last_refreshed_at) values (true, false, now())
on conflict (id) do nothing;
alter table public.attraction_refresh_state enable row level security;  -- no policy: SQL only

create or replace function public.mark_attraction_breweries_dirty()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  update attraction_refresh_state set dirty = true where not dirty;
  return null;
end;
$fn$;

drop trigger if exists breweries_mark_attraction_breweries_dirty on public.breweries;
create trigger breweries_mark_attraction_breweries_dirty
  after insert or delete or update of latitude, longitude on public.breweries
  for each statement execute function public.mark_attraction_breweries_dirty();

create or replace function public.refresh_attraction_breweries_if_dirty()
returns jsonb
language plpgsql
set search_path = public
as $fn$
declare
  result jsonb;
begin
  if not (select dirty from attraction_refresh_state) then
    return null;
  end if;
  -- clear first: a change made while refreshing marks it dirty again for the next run
  update attraction_refresh_state set dirty = false;
  result := refresh_attraction_breweries();
  update attraction_refresh_state set last_refreshed_at = now();
  return result;
end;
$fn$;

revoke execute on function public.refresh_attraction_breweries_if_dirty() from public, anon, authenticated;
revoke execute on function public.mark_attraction_breweries_dirty() from public, anon, authenticated;

select cron.schedule(
  'refresh-attraction-breweries',
  '*/30 * * * *',
  $$select public.refresh_attraction_breweries_if_dirty()$$
);
