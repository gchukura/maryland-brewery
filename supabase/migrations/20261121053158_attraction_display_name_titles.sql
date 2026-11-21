-- Display names for two attraction pages whose titles read badly when cut to 60 characters
-- ("…Ohio Canal National, Potomac", "Thomas A. Dixon, Glen Burnie"). See 20261121050029_attraction_overrides.
insert into public.maryland_attraction_overrides as o (place_id, display_name, reason, source)
values
  ('ChIJm1lgIFjsyYkRKew8l_ZZ3FA', 'C&O Canal National Historical Park', 'title: the park''s own short form fits the page title', 'near-titles-2026-11'),
  ('ChIJnVnrlyLjt4kRtd40_ZYyUOY', 'Thomas A. Dixon Aircraft Observation Area', 'title: without ", Jr." the title isn''t cut at the comma', 'near-titles-2026-11')
on conflict (place_id) do update set display_name = excluded.display_name, reason = o.reason || '; ' || excluded.reason;

update public.maryland_attraction_overrides o
set previous_category = a.category, previous_duplicate_of = a.duplicate_of, previous_is_pseo_eligible = a.is_pseo_eligible
from public.maryland_attractions a
where a.place_id = o.place_id and o.previous_is_pseo_eligible is null;

select public.apply_attraction_overrides();
