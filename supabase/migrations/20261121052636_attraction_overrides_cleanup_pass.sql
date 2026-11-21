-- Second /near cleanup pass: places on the type pages' A-to-Z lists that aren't things to do
-- (parking lots, cemeteries, school ball fields, a hotel, city property, military or private camps).
-- Kept on purpose: historic churches, Green Mount Cemetery (a landmark), school museums.
-- Uses maryland_attraction_overrides (20261121050029), so it survives a re-import.

insert into public.maryland_attraction_overrides as o (place_id, hidden, reason, source)
select v.place_id, true, v.reason, 'near-cleanup-pass-2026-11' from (values
  ('ChIJVVVVAnkSyIkRWE14YnXY-Wc', 'not a destination: "Baltimore City Property", no reviews'),
  ('ChIJBas0VQAlyIkRC6TniYXHMrY', 'not a destination: elementary school ball field (Eldersburg Field 10)'),
  ('ChIJNUvgOgAlyIkR5mtUXN0SYuc', 'not a destination: elementary school ball field (Eldersburg Field 11A)'),
  ('ChIJUREXZQAlyIkRBAOW7dMTLx8', 'not a destination: elementary school ball field (Eldersburg Field 11B)'),
  ('ChIJY31ZAwAlyIkRCayN7mZdJ_Y', 'not a destination: elementary school ball field (Eldersburg Field 123)'),
  ('ChIJOWSjRgA7yIkRGyUHRBpQi20', 'not a destination: elementary school ball field (Eldersburg Field 8)'),
  ('ChIJK9I_IwA7yIkRB3c9N4ykhGk', 'not a destination: elementary school ball field (Eldersburg Field 9)'),
  ('ChIJoSED-CoGyIkRRHsRoelRhPU', 'not a destination: cemetery (Gardens of Faith Memorial Gardens)'),
  ('ChIJT2FfzcXix4kR_MZHYgyLgLc', 'not a destination: cemetery (Holly Hill Memorial Gardens)'),
  ('ChIJ78Ug0oDyt4kRxqTgM-DpQZQ', 'not a destination: cemetery (Lakemont Memorial Gardens)'),
  ('ChIJ_40gRbgdyIkRYlG_1Z8uDYE', 'not a destination: cemetery (Arbutus Memorial Park)'),
  ('ChIJCzsjwrcDuYkR0eY7iYIXP4k', 'not a destination: cemetery (Parsons Cemetery)'),
  ('ChIJpQ6EWQApuYkRaPMUuxDP3SM', 'not a destination: parking lot'),
  ('ChIJL2UyewApuYkRBORBID7ypxk', 'not a destination: hotel parking lot'),
  ('ChIJ-yAJraIEyIkRlBbBnA2V5gg', 'not a destination: hotel'),
  ('ChIJx554JUz2t4kR820KNXXv1Ss', 'not a destination: military-only lodging and campground (NSA Annapolis)'),
  ('ChIJtaxFQdPlt4kRlKpqeRGdp-k', 'not a destination: military-only camp (Fort Meade)'),
  ('ChIJT-lwstXlt4kRo64mUWVgM1E', 'not a destination: military-only RV park (Fort Meade); already excluded from attraction pages'),
  ('ChIJsfK6SEr2t4kRgh2KkVik758', 'not a destination: sports camp'),
  ('ChIJsVAV9YrXuYkRZKhpqoCCms4', 'not a destination: campground for Chesapeake Ranch Estates residents'),
  ('ChIJUUj_nOXDt4kRrKAHcnFKtrs', 'not a destination: youth organization camp')
) as v(place_id, reason)
on conflict (place_id) do update
set hidden = true,
    reason = o.reason || '; ' || excluded.reason;

update public.maryland_attraction_overrides o
set previous_category = a.category,
    previous_duplicate_of = a.duplicate_of,
    previous_is_pseo_eligible = a.is_pseo_eligible
from public.maryland_attractions a
where a.place_id = o.place_id and o.previous_is_pseo_eligible is null;

select public.apply_attraction_overrides();
select public.refresh_attraction_breweries();
