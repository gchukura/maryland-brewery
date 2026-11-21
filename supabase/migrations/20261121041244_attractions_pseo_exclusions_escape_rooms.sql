-- More pSEO exclusions (see 20261121035820_attractions_pseo_exclusions), then rebuild
-- attraction_breweries and has_pseo_page.
update public.maryland_attractions set is_pseo_eligible = false
where place_id in (
  'ChIJQ3RV6J7vt4kRNThTQBh2gq4', -- Mission Escape Rooms, Gambrills (escape room tagged tourist_attraction)
  'ChIJqTvZwiI_uIkRbfivpld-c4U'  -- EscapeTime Escape Rooms, Easton (same)
);

select public.refresh_attraction_breweries();
