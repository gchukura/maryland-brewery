-- Undo 20261121050029_attraction_overrides (the /near cleanup). Run by hand in the SQL editor;
-- this folder is not applied by `supabase db push`.
-- Restores each overridden row's category, duplicate_of and is_pseo_eligible as they were before
-- the override, removes the trigger, functions, table and columns, then rebuilds the brewery links.

begin;

drop trigger if exists maryland_attractions_apply_override on public.maryland_attractions;

update public.maryland_attractions a
set category = o.previous_category,
    duplicate_of = o.previous_duplicate_of,
    is_pseo_eligible = coalesce(o.previous_is_pseo_eligible, a.is_pseo_eligible)
from public.maryland_attraction_overrides o
where o.place_id = a.place_id;

drop function if exists public.apply_attraction_overrides();
drop function if exists public.apply_attraction_override();
drop table if exists public.maryland_attraction_overrides;

alter table public.maryland_attractions
  drop column if exists is_hidden,
  drop column if exists display_name;

select public.refresh_attraction_breweries();

commit;
