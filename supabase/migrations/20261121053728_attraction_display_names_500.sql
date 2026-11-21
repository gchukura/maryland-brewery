-- Display names for attraction pages added by ATTRACTION_PAGE_MIN_REVIEWS = 500 whose titles were cut
-- at a "/" ("Breweries near Hagerstown, Williamsport" for a KOA campground). See 20261121050029_attraction_overrides.
insert into public.maryland_attraction_overrides as o (place_id, display_name, reason, source)
values
  ('ChIJk2qXm33zyYkR7eZ-khy4WXk', 'Antietam Battlefield KOA', 'title: was cut to "Hagerstown"', 'near-titles-2026-11'),
  ('ChIJ8-d9ijblt4kR_r1ZCq-eeG0', 'Capitol KOA Holiday', 'title: was cut to "Washington DC"', 'near-titles-2026-11'),
  ('ChIJ63LL-L3Xx4kRZUiJJlx9nig', 'Kilgore Falls at Rocks State Park', 'title: was cut to "Rocks State Park", the name of another page', 'near-titles-2026-11')
on conflict (place_id) do update set display_name = excluded.display_name, reason = o.reason || '; ' || excluded.reason;

update public.maryland_attraction_overrides o
set previous_category = a.category, previous_duplicate_of = a.duplicate_of, previous_is_pseo_eligible = a.is_pseo_eligible
from public.maryland_attractions a
where a.place_id = o.place_id and o.previous_is_pseo_eligible is null;

select public.apply_attraction_overrides();
