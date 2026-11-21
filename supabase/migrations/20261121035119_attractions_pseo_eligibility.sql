-- Classify maryland_attractions for programmatic pages.
-- `type` is unreliable ("landmark" includes restaurants, malls, salons...); google_types is the
-- source for everything below. No rows are deleted. Safe to re-run: every step recomputes.

-- 1. Columns
alter table public.maryland_attractions
  add column if not exists is_pseo_eligible boolean not null default false,
  add column if not exists category text,
  add column if not exists duplicate_of uuid
    references public.maryland_attractions(id) on delete set null;

-- 2. Category, first match in priority order (null when none match)
update public.maryland_attractions set category = case
  when google_types ? 'stadium'            then 'stadium'
  when google_types ? 'zoo'                then 'zoo'
  when google_types ? 'aquarium'           then 'aquarium'
  when google_types ? 'amusement_park'     then 'amusement_park'
  when google_types ? 'museum'             then 'museum'
  when google_types ? 'campground'         then 'campground'
  when google_types ? 'park'               then 'park'
  when google_types ? 'tourist_attraction' then 'tourist_attraction'
end;

-- 3. Eligibility from google_types + review count (null rating_count counts as < 100)
update public.maryland_attractions set is_pseo_eligible = (
  google_types ?| array['tourist_attraction','park','museum','zoo','aquarium',
                        'amusement_park','stadium','campground']
  and not google_types ?| array['spa','health','beauty_salon','hair_care','doctor',
    'restaurant','meal_takeaway','meal_delivery','store','shopping_mall','school','finance',
    'general_contractor','car_repair','travel_agency','gym','place_of_worship',
    'local_government_office','bar','night_club','cafe','bakery']
  -- campgrounds and parks with camping are always tagged lodging; only hotels are excluded
  and not (google_types ? 'lodging' and not google_types ?| array['campground','park','rv_park'])
  and coalesce(rating_count, 0) >= 100
);

-- 4. County from the nearest brewery within 15 miles (24,140 m); rows with none stay null
update public.maryland_attractions a set county = nb.county
from (
  select a2.id, b.county
  from public.maryland_attractions a2
  cross join lateral (
    select b.county
    from public.breweries b
    where b.latitude is not null and b.longitude is not null
      and nullif(btrim(b.county), '') is not null
      and ST_DWithin(ST_MakePoint(b.longitude, b.latitude)::geography,
                     ST_MakePoint(a2.longitude, a2.latitude)::geography, 24140.16)
    order by ST_Distance(ST_MakePoint(b.longitude, b.latitude)::geography,
                         ST_MakePoint(a2.longitude, a2.latitude)::geography)
    limit 1
  ) b
  where nullif(btrim(a2.county), '') is null
) nb
where a.id = nb.id;

-- 5. Duplicates: attraction-type rows (good google_types, none of the excluded ones) within
-- 300 m whose normalized names are equal or one contains the other as whole words
-- ("Camden Yards" / "Oriole Park at Camden Yards"). The row with more reviews wins (ties: lower id).
-- duplicate_of points at the best-ranked similar neighbour, then chains are collapsed to the root.
update public.maryland_attractions set duplicate_of = null where duplicate_of is not null;

with cand as (
  select id, coalesce(rating_count, 0) rc, latitude, longitude,
    ST_MakePoint(longitude, latitude)::geography g,
    regexp_replace(btrim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')), '^the ', '') nn
  from public.maryland_attractions
  where google_types ?| array['tourist_attraction','park','museum','zoo','aquarium',
                              'amusement_park','stadium','campground']
    and not google_types ?| array['spa','health','beauty_salon','hair_care','doctor',
      'restaurant','meal_takeaway','meal_delivery','store','shopping_mall','school','finance',
      'general_contractor','car_repair','travel_agency','gym','place_of_worship',
      'local_government_office','bar','night_club','cafe','bakery']
    and not (google_types ? 'lodging' and not google_types ?| array['campground','park','rv_park'])
),
pairs as (
  -- loser l, winner w
  select l.id loser, w.id winner, w.rc, w.id::text wid
  from cand l
  join cand w on w.id <> l.id
    and (w.rc > l.rc or (w.rc = l.rc and w.id::text < l.id::text))
    and abs(w.latitude - l.latitude) < 0.003 and abs(w.longitude - l.longitude) < 0.004
    and ST_DWithin(w.g, l.g, 300)
    and (w.nn = l.nn
         or position(' ' || w.nn || ' ' in ' ' || l.nn || ' ') > 0
         or position(' ' || l.nn || ' ' in ' ' || w.nn || ' ') > 0)
),
best as (
  select distinct on (loser) loser, winner from pairs order by loser, rc desc, wid
)
update public.maryland_attractions a set duplicate_of = best.winner
from best where a.id = best.loser;

-- collapse chains (A -> B -> C becomes A -> C)
with recursive chain as (
  select id, duplicate_of root from public.maryland_attractions where duplicate_of is not null
  union all
  select c.id, a.duplicate_of
  from chain c join public.maryland_attractions a on a.id = c.root
  where a.duplicate_of is not null
)
update public.maryland_attractions a set duplicate_of = r.root
from (
  select distinct on (c.id) c.id, c.root from chain c
  join public.maryland_attractions t on t.id = c.root and t.duplicate_of is null
) r
where a.id = r.id and a.duplicate_of <> r.root;

update public.maryland_attractions set is_pseo_eligible = false where duplicate_of is not null;

-- 6. City is a US state name (bad geocode: street and city are just the state, no zip).
-- Rows with a zip are real towns, e.g. California, MD 20619.
update public.maryland_attractions set is_pseo_eligible = false
where lower(btrim(city)) in ('alabama','alaska','arizona','arkansas','california','colorado',
  'connecticut','delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
  'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan','minnesota',
  'mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey',
  'new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon',
  'pennsylvania','rhode island','south carolina','south dakota','tennessee','texas','utah',
  'vermont','virginia','washington','west virginia','wisconsin','wyoming','district of columbia')
  and nullif(btrim(zip), '') is null;

create index if not exists maryland_attractions_pseo_idx
  on public.maryland_attractions (category) where is_pseo_eligible;
