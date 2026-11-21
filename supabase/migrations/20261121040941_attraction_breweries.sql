-- Breweries near each pSEO-eligible attraction, and which attractions get a page.
-- Rebuild with: select public.refresh_attraction_breweries();
-- (after adding or moving breweries, or after changing is_pseo_eligible)

create table if not exists public.attraction_breweries (
  attraction_id  uuid not null references public.maryland_attractions(id) on delete cascade,
  brewery_id     text not null references public.breweries(id) on delete cascade,
  distance_miles double precision not null,
  rank           integer not null,  -- 1 = nearest
  primary key (attraction_id, brewery_id)  -- also serves lookups by attraction_id
);

create index if not exists attraction_breweries_brewery_id_idx
  on public.attraction_breweries (brewery_id);

alter table public.attraction_breweries enable row level security;

drop policy if exists "Public can read attraction_breweries" on public.attraction_breweries;
create policy "Public can read attraction_breweries"
  on public.attraction_breweries for select to public using (true);

alter table public.maryland_attractions
  add column if not exists nearby_brewery_count_5mi  integer not null default 0,
  add column if not exists nearby_brewery_count_10mi integer not null default 0,
  add column if not exists has_pseo_page boolean not null default false;

create or replace function public.refresh_attraction_breweries()
returns jsonb
language plpgsql
set search_path = public
as $fn$
declare
  pairs integer;
  pages integer;
begin
  -- 1. Pairs: every brewery within 10 miles (16,093.44 m) of an eligible attraction
  delete from attraction_breweries where true;

  insert into attraction_breweries (attraction_id, brewery_id, distance_miles, rank)
  select a.id, b.id, d.meters / 1609.344,
         row_number() over (partition by a.id order by d.meters, b.id)
  from maryland_attractions a
  join breweries b
    on b.latitude is not null and b.longitude is not null
   and ST_DWithin(ST_MakePoint(a.longitude, a.latitude)::geography,
                  ST_MakePoint(b.longitude, b.latitude)::geography, 16093.44)
  cross join lateral (
    select ST_Distance(ST_MakePoint(a.longitude, a.latitude)::geography,
                       ST_MakePoint(b.longitude, b.latitude)::geography) as meters
  ) d
  where a.is_pseo_eligible;
  get diagnostics pairs = row_count;

  -- 2. Counts for every attraction (eligible or not)
  update maryland_attractions a
  set nearby_brewery_count_5mi  = c.n5,
      nearby_brewery_count_10mi = c.n10
  from (
    select a2.id,
      count(b.id) filter (where ST_DWithin(ST_MakePoint(a2.longitude, a2.latitude)::geography,
                                           ST_MakePoint(b.longitude, b.latitude)::geography, 8046.72))::int n5,
      count(b.id)::int n10
    from maryland_attractions a2
    left join breweries b
      on b.latitude is not null and b.longitude is not null
     and ST_DWithin(ST_MakePoint(a2.longitude, a2.latitude)::geography,
                    ST_MakePoint(b.longitude, b.latitude)::geography, 16093.44)
    group by a2.id
  ) c
  where a.id = c.id
    and (a.nearby_brewery_count_5mi, a.nearby_brewery_count_10mi) is distinct from (c.n5, c.n10);

  -- 3. A page needs an eligible attraction with 2+ breweries within 10 miles
  update maryland_attractions
  set has_pseo_page = (is_pseo_eligible and nearby_brewery_count_10mi >= 2)
  where has_pseo_page is distinct from (is_pseo_eligible and nearby_brewery_count_10mi >= 2);

  select count(*) into pages from maryland_attractions where has_pseo_page;
  return jsonb_build_object('pairs', pairs, 'pages', pages);
end;
$fn$;

-- Supabase exposes public functions over RPC; only the service role and SQL may rebuild.
revoke execute on function public.refresh_attraction_breweries() from public, anon, authenticated;
grant execute on function public.refresh_attraction_breweries() to service_role;

select public.refresh_attraction_breweries();
