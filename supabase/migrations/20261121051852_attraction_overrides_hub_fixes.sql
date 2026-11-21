-- Fixes found in the /near hub's top-6 lists (see 20261121050029_attraction_overrides).
-- Rows that already have an override keep it (K1 Speed keeps its display name).
-- Hiding Washington Boulevard Marketplace removes one attraction page (98 -> 97).

insert into public.maryland_attraction_overrides as o (place_id, hidden, category, merge_into_place_id, reason, source)
select v.place_id, v.hidden, v.category, v.merge_into, v.reason, 'near-hub-fixes-2026-11' from (values
  -- K1 Speed
  ('ChIJAxR60M3gt4kRXJJM-dD6GFU', false, 'bowling_games', null, 'wrong type: indoor go-kart track, not a landmark'),
  -- Toby's Dinner Theatre
  ('ChIJIVfGYrvft4kRPot6bd5L8XQ', false, 'cinema_theater', null, 'wrong type: dinner theater, not a landmark'),
  -- Pimlico Race Course
  ('ChIJ9cAt1vEayIkRJttdTqdQ9dQ', false, 'casino', null, 'wrong type: horse racing track, grouped with gaming'),
  -- Washington Boulevard Marketplace
  ('ChIJH7bGkQbht4kRc5Fg0wlKmBE', true, null, null, 'not a destination: indoor market (shopping)'),
  -- Fort Lincoln Funeral Home & Cemetery
  ('ChIJmSCtjWXHt4kRQDoRkUJoGVA', true, null, null, 'not a destination: funeral home and cemetery (Google: cemetery, funeral_home)'),
  -- Tropical Lagoon Aquarium
  ('ChIJr6xDs8zIt4kRef394xLoJjg', true, null, null, 'not a destination: aquarium fish store (Google: pet_store, store)'),
  -- Marine Mammal Pavilion
  ('ChIJv5rh1WIDyIkRw8BWpRoGfSQ', true, null, 'ChIJXVZn5GIDyIkRjn58fGGo8Mc', 'sub-part: a building of the National Aquarium, 130 m away')
) as v(place_id, hidden, category, merge_into, reason)
on conflict (place_id) do update
set hidden = o.hidden or excluded.hidden,
    category = coalesce(excluded.category, o.category),
    merge_into_place_id = coalesce(excluded.merge_into_place_id, o.merge_into_place_id),
    reason = o.reason || '; ' || excluded.reason;

update public.maryland_attraction_overrides o
set previous_category = a.category,
    previous_duplicate_of = a.duplicate_of,
    previous_is_pseo_eligible = a.is_pseo_eligible
from public.maryland_attractions a
where a.place_id = o.place_id and o.previous_is_pseo_eligible is null;

select public.apply_attraction_overrides();
select public.refresh_attraction_breweries();
