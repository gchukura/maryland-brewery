-- More pSEO exclusions (see 20261121035820_attractions_pseo_exclusions), then rebuild
-- attraction_breweries and has_pseo_page.
update public.maryland_attractions set is_pseo_eligible = false
where place_id in (
  'ChIJjxPm4BUOyIkRtSGjgVVMYVM'  -- Breakout Games, Timonium (escape-room chain tagged tourist_attraction)
);

select public.refresh_attraction_breweries();
