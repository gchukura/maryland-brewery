-- Manual overrides for maryland_attractions (the /near cleanup, reviewed in
-- scripts/output/near-cleanup-proposal.csv). Nothing is deleted.
--
-- How the overrides survive a re-import: they live in maryland_attraction_overrides, keyed by Google
-- place_id (the import upserts on place_id). A BEFORE INSERT OR UPDATE trigger copies each row's
-- override onto it, so an upsert from scripts/fetch-maryland-attractions.ts, a re-run of the
-- eligibility migration or refresh_attraction_breweries() all keep them. The raw imported columns
-- (name, type, google_types) are never changed: display_name overrides the name for display.
--
--   hidden               not shown anywhere (also not eligible for an attraction page)
--   display_name         shown instead of name
--   category             replaces the category derived from google_types
--   merge_into_place_id  a duplicate or sub-part of that place: hidden, duplicate_of set to it
--
-- To change an override: insert/update/delete rows in the table, then
--   select public.apply_attraction_overrides(); select public.refresh_attraction_breweries();
-- To undo all of this: supabase/rollbacks/attraction_overrides.down.sql

alter table public.maryland_attractions
  add column if not exists is_hidden boolean not null default false,
  add column if not exists display_name text;

create table if not exists public.maryland_attraction_overrides (
  place_id             text primary key,
  hidden               boolean not null default false,
  display_name         text,
  category             text,
  merge_into_place_id  text,
  reason               text,
  source               text not null default 'near-cleanup-2026-11',
  created_at           timestamptz not null default now(),
  -- what the row had before its override was first applied (for the rollback)
  previous_category          text,
  previous_duplicate_of      uuid,
  previous_is_pseo_eligible  boolean,
  constraint merge_means_hidden check (merge_into_place_id is null or hidden)
);

-- Admin data: no public policy, so only the service role (and SQL) can read or write it
alter table public.maryland_attraction_overrides enable row level security;

create or replace function public.apply_attraction_override()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  o maryland_attraction_overrides%rowtype;
begin
  select * into o from maryland_attraction_overrides where place_id = new.place_id;
  if not found then
    return new;
  end if;
  new.is_hidden := o.hidden;
  new.display_name := o.display_name;
  if o.category is not null then
    new.category := o.category;
  end if;
  if o.merge_into_place_id is not null then
    new.duplicate_of := (select id from maryland_attractions where place_id = o.merge_into_place_id);
  end if;
  if o.hidden then
    new.is_pseo_eligible := false;
  end if;
  return new;
end;
$fn$;

drop trigger if exists maryland_attractions_apply_override on public.maryland_attractions;
create trigger maryland_attractions_apply_override
  before insert or update on public.maryland_attractions
  for each row execute function public.apply_attraction_override();

-- Re-applies every override (after editing the table). Rows whose override was deleted lose
-- is_hidden and display_name; their category and eligibility come back with the next run of the
-- eligibility rules.
create or replace function public.apply_attraction_overrides()
returns integer
language plpgsql
set search_path = public
as $fn$
declare
  n integer;
begin
  update maryland_attractions set is_hidden = false, display_name = null
  where (is_hidden or display_name is not null)
    and place_id not in (select place_id from maryland_attraction_overrides);
  -- a no-op update fires the trigger, which copies the override onto the row
  update maryland_attractions set place_id = place_id
  where place_id in (select place_id from maryland_attraction_overrides);
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke execute on function public.apply_attraction_overrides() from public, anon, authenticated;
grant execute on function public.apply_attraction_overrides() to service_role;

insert into public.maryland_attraction_overrides (place_id, hidden, display_name, category, merge_into_place_id, reason) values
  -- National Aquarium Baltimore
  ('ChIJh7UXSQADyIkR8fezdqk9nog', true, null, null, 'ChIJXVZn5GIDyIkRjn58fGGo8Mc', 'duplicate (high): Already flagged duplicate_of National Aquarium in the database'),
  -- Campground
  ('ChIJjW5QZOIftokRhoO7Lqp5jKs', true, null, null, 'ChIJNYkdyzEetokRLWtUwZMGhE4', 'duplicate (high): Already flagged duplicate_of Brunswick Family Campground in the database'),
  -- Annmarie Sculpture Garden, Solomons, MD
  ('ChIJfW36UW2Ft4kRWUIyB6AH15c', true, null, null, 'ChIJ6wQOeAvYuYkRSywHVddgcoA', 'duplicate (high): Same coordinates (0 m); keep Annmarie Sculpture Garden & Arts Center (1341 reviews)'),
  -- NSA
  ('ChIJpdiNAlvnt4kRgoswAfzZZEY', true, null, null, 'ChIJhZ98duPmt4kRHIrKufVvFug', 'duplicate (high): 7 m from the National Cryptologic Museum; the listing is the museum pin, not NSA itself; keep National Cryptologic Museum (1228 reviews)'),
  -- The Valley Art Association
  ('ChIJR9irLmbtyYkRfZhHMJQQiGU', true, null, null, 'ChIJodhaqkPtyYkR9PiUS0VDzXg', 'duplicate (high): Same coordinates (5 m apart) and overlapping names; keeping the one with more reviews (36 vs 2)'),
  -- National Park Service Cumberland Visitor Center
  ('ChIJtwMqBACPyokRYNotXiYIy4w', true, null, null, 'ChIJbSmfRtuOyokREMqTWO43nP0', 'duplicate (high): Same visitor center, 37 m apart; keep Cumberland Visitor Center (395 reviews)'),
  -- The Allegany County Historical Society
  ('ChIJE0iTTd2OyokR-sO9mvY9xvI', true, null, null, 'ChIJ7fEOTd2OyokRKjzre1ZF_R0', 'duplicate (medium): 6 m apart; the society runs the Gordon-Roberts House museum; keep Gordon-Roberts House (27 reviews)'),
  -- American Latvian Association
  ('ChIJgcjdoTjNt4kRhX0bfCEKFO4', true, null, null, 'ChIJyXyFnjjNt4kRuvg6C5wqtGQ', 'duplicate (medium): 5 m apart; the association houses the museum; keep The Latvian Museum (4 reviews)'),
  -- Frederick County Landmarks Foundation
  ('ChIJ7QvYugHbyYkRkqxL2kY8hNY', true, null, null, 'ChIJ7QvYugHbyYkRq-gD_K9MIYA', 'duplicate (medium): 7 m apart; the foundation runs the museum; keep Schifferstadt Architectural Museum (132 reviews)'),
  -- Hagerstown Railroad Museum
  ('ChIJ2ZWiyGftyYkRgTY5If8u_FE', true, null, null, 'ChIJczuPIWbtyYkRiCET5PC0RsQ', 'duplicate (medium): 4 m apart; the Train Hub is the railroad museum in City Park; keep City Park Train Hub (29 reviews)'),
  -- Live Arts Maryland
  ('ChIJXZQZgfb2t4kRBfXaJU6xJ8I', true, null, null, 'ChIJY6Rcefb2t4kR0Zq2kOrL1nQ', 'duplicate (medium): 13 m apart; a resident company of Maryland Hall; keep Maryland Hall (140 reviews)'),
  -- St. Mary's County Arts Council
  ('ChIJe4y0cBxmt4kRhTvLZ_nKhJ8', true, null, null, 'ChIJe4y0cBxmt4kRbvMxzvmSYX4', 'duplicate (medium): 4 m apart; the council runs the arts center; keep Leonardtown Arts Center (2 reviews)'),
  -- Baltimore and Annapolis (B&A) Trail
  ('ChIJW0DWmJv3t4kRnMDGjo4tdIw', true, null, null, 'ChIJW0DWmJv3t4kRv2t8zFIyKZo', 'duplicate (medium): Same coordinates (0 m); one trail; keep Baltimore-Annapolis Trail End (112 reviews)'),
  -- Great Wolf Lodge
  ('ChIJq6ciNAC5x4kRjeJTHso3JX0', true, null, null, 'ChIJvdrX1uK5x4kRx7dZUQmjeyY', 'duplicate (low): Same name but 3568 m apart; could be a separate site or a misplaced pin; keeping the one with more reviews (4157 vs 0)'),
  -- Stonestreet Museum
  ('ChIJ83WMRnPNt4kR6QK5OcCKOkQ', true, null, null, 'ChIJG5FBQXPNt4kRuTHMSIBj6sw', 'duplicate (low): Same coordinates; a separate small museum on the same campus, so a separate page may be fine; keep Beall-Dawson Museum (28 reviews)'),
  -- IMAX at the Maryland Science Center
  ('ChIJ0xODGGQDyIkRpJ7g6x35fJc', true, null, null, 'ChIJrzovrmYDyIkR890eAQG1Xpo', 'duplicate (low): Names overlap ("IMAX at the Maryland Science Center" / "Maryland Science Center"), 30 m apart; may be a separate attraction at the same site'),
  -- VisArts' 355 POD Space Gallery
  ('ChIJCaKJJVvNt4kRQHiSoyCgSXI', true, null, null, 'ChIJ6U-lUHTNt4kROHw4fdGc4cM', 'duplicate (low): Names overlap ("VisArts'' 355 POD Space Gallery" / "VisArts"), 137 m apart; may be a separate attraction at the same site'),
  -- Chesapeake & Ohio Canal National Historical Park
  ('ChIJ6x5Cp1jzyYkRRqWbhU0tRbo', true, null, null, 'ChIJm1lgIFjsyYkRKew8l_ZZ3FA', 'duplicate (low): Same name as the park''s main listing (2,733 reviews) but pinned at the Hagerstown headquarters, 90 km away'),
  -- Patterson Park Spray Pad
  ('ChIJFXuMAAAFyIkRESP_g_N9w6g', true, null, null, 'ChIJR8YzzHAEyIkRFVzfBdwjULc', 'sub-part (high): Already flagged duplicate_of Patterson Park in the database'),
  -- Hillcrest campground area 1
  ('ChIJuSJUXvSJyokRhzwRRIw8n8w', true, null, null, 'ChIJld0R_0SJyokRCrpmQnlN6U8', 'sub-part (high): 2 m apart; a camping area of the campground; keep Tractor World & Hillcrest River Campground. (6 reviews)'),
  -- At Play on the Bay Exhibition, CBMM
  ('ChIJ10ZNeVQ8uIkRXkG4nfLz4SI', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (high): Named as part of the museum; fold into Chesapeake Bay Maritime Museum'),
  -- Calvert Marine Museum Store
  ('ChIJdUUfhFljt4kRz_rUJhtpf0o', true, null, null, 'ChIJMXXGEIVit4kRSRDCb7rOgFo', 'sub-part (high): "store" of Calvert Marine Museum, 26 m apart; fold into the parent'),
  -- CBMM Welcome Center Entrance
  ('ChIJ2QVSalQ8uIkRmzDAyEDCqdk', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (high): Named as part of the museum; fold into Chesapeake Bay Maritime Museum'),
  -- Chesapeake Bay Maritime Museum - NORTH GATE
  ('ChIJQ6vZS1M9uIkRmbi32u2GI_E', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (high): Named as part of the museum; fold into Chesapeake Bay Maritime Museum'),
  -- Oystering on the Chesapeake, CBMM
  ('ChIJlQDwV1Q8uIkRjolwkaxoroU', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (high): Named as part of the museum; fold into Chesapeake Bay Maritime Museum'),
  -- Steamboat Building of CBMM
  ('ChIJ3-rD-1Q8uIkR_5rbOqNqpdw', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (high): Named as part of the museum; fold into Chesapeake Bay Maritime Museum'),
  -- Bollinger Park, Taneytown Parking
  ('ChIJvVllLAA3yIkRC1xVQX_7gj4', true, null, null, 'ChIJw_UHHQBLyIkRoWy5f_P9GhA', 'sub-part (high): Already flagged duplicate_of Bollinger Park, Taneytown in the database'),
  -- Community Garden at Patterson Park
  ('ChIJBaBJknAEyIkRvEX3BTFQETc', true, null, null, 'ChIJR8YzzHAEyIkRFVzfBdwjULc', 'sub-part (high): Already flagged duplicate_of Patterson Park in the database'),
  -- Constitution Park Gazebo
  ('ChIJaXT6CgCJyokR-jDEAbQtHzU', true, null, null, 'ChIJEQmNW82OyokR6tOIwUcvZ_s', 'sub-part (high): Already flagged duplicate_of Constitution Park in the database'),
  -- Pond at Crofton Park
  ('ChIJlTDGegDvt4kRKo1Hsl_2EDg', true, null, null, 'ChIJJZRKP0nut4kRMchMCBbOSe0', 'sub-part (high): Already flagged duplicate_of Crofton Park in the database'),
  -- City of Gaithersburg Water Park at Bohrer Park
  ('ChIJbfgfd8zSt4kRXDoHc-wEIF0', true, null, null, 'ChIJg_qMR8vSt4kRa8qp4i3Np5g', 'sub-part (medium): Already flagged duplicate_of Bohrer Park in the database; you chose to keep this flagged although it is a separate attraction at the site'),
  -- Sun Outdoors Frontier Town High Ropes Park
  ('ChIJPYFIqa4ouYkR_S4BgysseSc', true, null, null, 'ChIJk9uXNKwouYkRqeOYfVBCJ3w', 'sub-part (medium): Already flagged duplicate_of Sun Outdoors Frontier Town in the database; you chose to keep this flagged although it is a separate attraction at the site'),
  -- Sun Outdoors Frontier Town Water Park
  ('ChIJk9uXNKwouYkRuSw8P9S76VU', true, null, null, 'ChIJk9uXNKwouYkRqeOYfVBCJ3w', 'sub-part (medium): Already flagged duplicate_of Sun Outdoors Frontier Town in the database; you chose to keep this flagged although it is a separate attraction at the site'),
  -- Sun Outdoors Frontier Town Western Theme Park
  ('ChIJk8SXX6kouYkRBhfWIIFrVp0', true, null, null, 'ChIJk9uXNKwouYkRqeOYfVBCJ3w', 'sub-part (medium): Already flagged duplicate_of Sun Outdoors Frontier Town in the database; you chose to keep this flagged although it is a separate attraction at the site'),
  -- 1879 Hooper Strait Lighthouse, CBMM
  ('ChIJUQ0jd1Q8uIkRJGEEJh1GxTc', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (medium): Named as part of the museum; fold into Chesapeake Bay Maritime Museum (a well-known exhibit with 157 reviews; keep separate if you want a page for it)'),
  -- Coulbourne & Jewett Education Center
  ('ChIJrXRCDAA9uIkRscZocebrT9A', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (medium): A building on the museum campus (within 250 m); fold into Chesapeake Bay Maritime Museum'),
  -- Dorchester House
  ('ChIJFY5dsy09uIkRlReF8oLTf74', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (medium): A building on the museum campus (within 250 m); fold into Chesapeake Bay Maritime Museum'),
  -- Higgins House
  ('ChIJVxKeCwA9uIkR7y1rsq2hqGQ', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (medium): A building on the museum campus (within 250 m); fold into Chesapeake Bay Maritime Museum'),
  -- Mitchell House
  ('ChIJy1rVGTE9uIkRkc0D2qBh5Uk', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (medium): A building on the museum campus (within 250 m); fold into Chesapeake Bay Maritime Museum'),
  -- Norman and Ellen Plummer Center for Museum Collections
  ('ChIJfV_uRrU9uIkRi5f-Y0magEE', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (medium): A building on the museum campus (within 250 m); fold into Chesapeake Bay Maritime Museum'),
  -- Small Boat Shed
  ('ChIJRRtCVBc9uIkRu0-GqRZL94M', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (medium): A building on the museum campus (within 250 m); fold into Chesapeake Bay Maritime Museum'),
  -- Van Lennep Auditorium
  ('ChIJ6wfhVgA9uIkRGzvwhBC0jQI', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (medium): A building on the museum campus (within 250 m); fold into Chesapeake Bay Maritime Museum'),
  -- Waterfowling Building
  ('ChIJkyq9QlQ8uIkRHY_m_hsGIfM', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (medium): A building on the museum campus (within 250 m); fold into Chesapeake Bay Maritime Museum'),
  -- Waterman's Wharf
  ('ChIJfRuUKeE9uIkRke-kyeHlcWQ', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (medium): A building on the museum campus (within 250 m); fold into Chesapeake Bay Maritime Museum'),
  -- The Terrace at Horseshoe Casino
  ('ChIJrTHlX7EDyIkRnIC5pUmTLFY', true, null, null, 'ChIJ0wy0ekYDyIkRXjZax7r4njA', 'sub-part (medium): 2 m apart; a restaurant inside the casino; keep Horseshoe Casino Baltimore - A Caesars Rewards Destination (10353 reviews)'),
  -- Rapids Area Parking & Trailhead Rock State Park
  ('ChIJm38RoznZx4kRO4EUB6fvcO8', true, null, null, 'ChIJ5c40hQvYx4kRSUAq23yOCGE', 'sub-part (medium): Parking and trailhead of Rocks State Park'),
  -- Savage Mill Trail
  ('ChIJV5COe_bdt4kRolMQzoUTs8g', true, null, null, 'ChIJRbmigVjnt4kRJM6kVaFpuB4', 'sub-part (medium): "trail" of Savage Mill, 187 m apart; fold into the parent'),
  -- Glen Echo Park Aquarium
  ('ChIJkb6p6FrKt4kRC0lbc9acgPU', true, null, null, 'ChIJ4Uwo9lrKt4kR_qOgXjs4oIk', 'sub-part (medium): Already flagged duplicate_of Glen Echo Park in the database; you chose to keep this flagged although it is a separate attraction at the site'),
  -- Classic Yacht ELF
  ('ChIJKVjOtRE9uIkRAIA11Ye-fJw', true, null, null, 'ChIJA_8UmVU8uIkRUgHGyGOIeyY', 'sub-part (low): A historic yacht 400 m away, likely docked at the museum; check'),
  -- Purple Trail
  ('ChIJ0QmXKQDZx4kRIGvldDS2rXE', true, null, null, 'ChIJ5c40hQvYx4kRSUAq23yOCGE', 'sub-part (low): 8 m from the Rocks State Park trailhead; a trail in the park'),
  -- Glen Echo Park
  ('ChIJ4Uwo9lrKt4kR_qOgXjs4oIk', false, null, 'park', null, 'wrong type (high): A national park site (carousel, arts, ballroom); listed as an aquarium only because Google includes its small aquarium'),
  -- Chimpanzee Forest
  ('ChIJ-SrKotcbyIkRnMgmKbDNW4E', false, null, 'park', null, 'wrong type (low): Listed as a zoo but the name doesn''t say so'),
  -- FantaSEA Aquariums | Aquarium Design, Installation, Service 
  ('ChIJRSGr4eKRt4kRtOxXHKyIr3I', true, null, null, null, 'not a destination (high): Aquarium design company and fish store, not a public aquarium'),
  -- Dr. Andrew Arnouk
  ('ChIJMwyvm3Tdt4kRGUOBszo1dAU', true, null, null, null, 'not a destination (high): A business that sells a service (Google: campground, health, lodging, park)'),
  -- Maryland DNR - Forest Service
  ('ChIJ5ZNzEMADuYkRKHCWF8Otg0Q', true, null, null, null, 'not a destination (high): Government office, maintenance site or agency, not somewhere to visit'),
  -- Maryland Forest Services
  ('ChIJBQwDD51muIkRBOTVw_S0Ly0', true, null, null, null, 'not a destination (high): Government office, maintenance site or agency, not somewhere to visit'),
  -- Natural Resources Department
  ('ChIJb1yt5qsttokRDvkAtAivcxw', true, null, null, null, 'not a destination (high): Government office, maintenance site or agency, not somewhere to visit'),
  -- Rockville Parks & Recreation
  ('ChIJKyhVAgvNt4kRwt3-DlcPDqo', true, null, null, null, 'not a destination (high): City department office'),
  -- Edgar M Bosley Jr Municipal Building
  ('ChIJzZ7SylU8uIkRBm01EfbxU8c', true, null, null, null, 'not a destination (high): St. Michaels town office'),
  -- Expo Architects Edutainment, LLC
  ('ChIJ4QZVMr_tyYkRpqaDmJauLZM', true, null, null, null, 'not a destination (high): Exhibit design firm, not a museum'),
  -- "Consider It Done" Boutique
  ('ChIJ-XvABmPJt4kRA5WjpNtkrYM', true, null, null, null, 'not a destination (high): A business that sells a service (Google: art_gallery, general_contractor, home_goods_store, store)'),
  -- ArtSea Ink
  ('ChIJdzxE8sQGyIkRJuy2oi360Zg', true, null, null, null, 'not a destination (high): A business that sells a service (Google: art_gallery, florist, general_contractor, painter, store)'),
  -- Betsy J. Cohen, AuD
  ('ChIJ4eJHkbbAx4kRqgldKiBUD-Y', true, null, null, null, 'not a destination (high): A business that sells a service (Google: art_gallery, doctor, electronics_store, health, store)'),
  -- Casewerks, LLC
  ('ChIJh6FF7JQEyIkRkGIb6iW6EBM', true, null, null, null, 'not a destination (high): A business that sells a service (Google: art_gallery, general_contractor)'),
  -- Classic Imports & Design
  ('ChIJ_XjadXESyIkR7QV5RxYxUTQ', true, null, null, null, 'not a destination (high): A business that sells a service (Google: art_gallery, furniture_store, general_contractor, home_goods_store, store)'),
  -- Elite Gaming Delmarva
  ('ChIJB4lvMHQDuYkR9w0-p4oG208', true, null, null, null, 'not a destination (high): A business that sells a service (Google: bar, health, night_club, store)'),
  -- Fowl Play Studios
  ('ChIJn2b4nAW2x4kRw04vV6RTMEY', true, null, null, null, 'not a destination (high): A business that sells a service (Google: art_gallery, general_contractor, store)'),
  -- Full Moon Acupuncture & Apothecary
  ('ChIJVSGxJygFyIkRkncHvYqakDg', true, null, null, null, 'not a destination (high): A business that sells a service (Google: art_gallery, health)'),
  -- Gentlemen Ten
  ('ChIJswALdVcbyIkRqufet3c28EU', true, null, null, null, 'not a destination (high): A business that sells a service (Google: bar, hair_care, health, night_club)'),
  -- Golden Lines and Silver Linings, JJ Hogan Art+Design
  ('ChIJwVg4pqyvt4kRw6LkpEgBg4U', true, null, null, null, 'not a destination (high): A business that sells a service (Google: art_gallery, clothing_store, store)'),
  -- Hotel Indigo Baltimore Downtown by IHG
  ('ChIJfy1w7ZgEyIkRa_2n1JZ73B8', true, null, null, null, 'not a destination (high): Hotel'),
  -- Ingrid McCoy Art & Design
  ('ChIJO0PAX_sDyIkRs4uMmjGPU3Y', true, null, null, null, 'not a destination (high): A business that sells a service (Google: art_gallery)'),
  -- Kramer Installation, Inc.
  ('ChIJUdHD6a5pyIkR55A0-CHbL0M', true, null, null, null, 'not a destination (high): A business that sells a service (Google: art_gallery, general_contractor, moving_company, storage, store)'),
  -- Local By Design Downtown
  ('ChIJIxtMnU_2t4kR6m0yefnLeQc', true, null, null, null, 'not a destination (high): A business that sells a service (Google: art_gallery, store)'),
  -- The Relocation Room Private Club
  ('ChIJh6bJ8W3Tt4kRQMSbHq_8rO8', true, null, null, null, 'not a destination (high): Private, for residents only'),
  -- Unique Art Design
  ('ChIJlx2LGPPdt4kR5oXMCVlGiAA', true, null, null, null, 'not a destination (high): A business that sells a service (Google: art_gallery)'),
  -- Wilde Lake Community Association
  ('ChIJb02UNHTft4kRGZbXeaSDdGc', true, null, null, null, 'not a destination (high): Private, for residents only'),
  -- Zen and the City
  ('ChIJmdXUXZYEyIkRwoBrnkvh5jY', true, null, null, null, 'not a destination (high): A business that sells a service (Google: art_gallery, beauty_salon, gym, health, spa, store)'),
  -- Caroline County Recreation and Parks
  ('ChIJZZyY7BZkuIkRHs6dTGE1mk4', true, null, null, null, 'not a destination (high): County department office'),
  -- Constitution Park Offices
  ('ChIJX5EHoF-PyokReJKg1N56oWg', true, null, null, null, 'not a destination (high): Office building of a park'),
  -- Dr. Robert M. Johnson, DDS
  ('ChIJa2KUbDuJyokR32SRbGkEM98', true, null, null, null, 'not a destination (high): A business that sells a service (Google: park)'),
  -- Elkton Parks & Recreation Department
  ('ChIJnyeSdGivx4kRVWCEYpRkTNg', true, null, null, null, 'not a destination (high): Government office, maintenance site or agency, not somewhere to visit'),
  -- Essex Stembridge Rec Office
  ('ChIJTRciyHQHyIkRGfW_UKMdCSQ', true, null, null, null, 'not a destination (high): Government office, maintenance site or agency, not somewhere to visit'),
  -- Hershey park
  ('ChIJR10pNQApuYkRG9Yjf5gmR68', true, null, null, null, 'not a destination (high): Misnamed pin at the Frontier Town theme park; not Hersheypark'),
  -- Meades crossing dog park - private for Meade’s Crossing Resi
  ('ChIJDZl7ltpLyIkR8GoLWoGjBB4', true, null, null, null, 'not a destination (high): Private, for residents only'),
  -- Recreation & Parks Department
  ('ChIJ89ADOz5kuIkRYuqGfsaNvD0', true, null, null, null, 'not a destination (high): County department office'),
  -- Terra Cafe
  ('ChIJuUTXiegEyIkRaHPl2VO2Oqs', true, null, null, null, 'not a destination (high): Cafe (Google: bar, cafe, food)'),
  -- Wicomico County Parks Maintenance
  ('ChIJMRHDtX4BuYkRwtI_eLgexWw', true, null, null, null, 'not a destination (high): Government office, maintenance site or agency, not somewhere to visit'),
  -- C & O Canal National Historical Park Headquarters
  ('ChIJKXEAhUu2t4kRdHmQtjfUSOw', true, null, null, null, 'not a destination (medium): Park headquarters office in Hagerstown; the park itself has its own entry'),
  -- C&O Canal Trust
  ('ChIJ3wHSilfsyYkRGv2FMct0yLU', true, null, null, null, 'not a destination (medium): Nonprofit office at the park headquarters'),
  -- Historic Ellicott City Inc. (HEC)
  ('ChIJ-UnTgKAfyIkRGboP7iUUk6g', true, null, null, null, 'not a destination (medium): Nonprofit office, not a site to visit'),
  -- Port Annapolis Marina
  ('ChIJuXumIxX2t4kRcOGM839JaU8', true, null, null, null, 'not a destination (medium): Private marina (Google: storage)'),
  -- St. Mary's Parish
  ('ChIJS4Fso0X2t4kRcZuzdXEEd1Y', true, null, null, null, 'not a destination (medium): Church and school'),
  -- Blacksky LLC
  ('ChIJzelHBGYFyIkRcIKuErRnR7o', true, null, null, null, 'not a destination (medium): Company listed as a museum; no sign it is open to visitors'),
  -- Brahma Kumaris Meditation Museums
  ('ChIJIXsO-bvIt4kRgi731An-Fzw', true, null, null, null, 'not a destination (medium): Meditation center (Google: health)'),
  -- Montgomery Preservation Inc
  ('ChIJkYfiMbzIt4kRdHVMQi_eYVQ', true, null, null, null, 'not a destination (medium): Preservation nonprofit office'),
  -- Art & Frame Depot
  ('ChIJ97cWdk3Nt4kReTvK6OWUfBE', true, null, null, null, 'not a destination (medium): Frame shop'),
  -- Bravura Arts & Framing, LLC
  ('ChIJ_bJxfN3byYkRj7he6Rt8Bg4', true, null, null, null, 'not a destination (medium): A business that sells a service (Google: art_gallery, store)'),
  -- D'Ann Danse Studios
  ('ChIJC09ZEFMCuYkRDz3CpKCHUUE', true, null, null, null, 'not a destination (medium): Dance school'),
  -- Full Circle Fine Art Services
  ('ChIJRa65LOoEyIkR7rtfI7kPnz8', true, null, null, null, 'not a destination (medium): Art services business'),
  -- Melinda Wade-English's Flute Gallery
  ('ChIJLdrvSMX5t4kRLM61KVe1gpU', true, null, null, null, 'not a destination (medium): Music shop and lessons'),
  -- New Door Creative Services
  ('ChIJuyoO0pQEyIkRGG0QAnlmbIQ', true, null, null, null, 'not a destination (medium): Creative services business'),
  -- O-Go Sales Company Inc.
  ('ChIJYyAdTpgGyIkRzifd8TTMNI8', true, null, null, null, 'not a destination (medium): A business that sells a service (Google: casino, home_goods_store, store)'),
  -- Rivers Edge Apartments and Studio for the Arts
  ('ChIJRQogzecDuYkRjmmX-4Svs8Y', true, null, null, null, 'not a destination (medium): Apartment building with artist studios; not open to visitors as a destination'),
  -- Unitarian Universalist Congregation of Frederick
  ('ChIJb4DvqOzeyYkR75H8MYFR-eY', true, null, null, null, 'not a destination (medium): Congregation (Google: school)'),
  -- Atlantic Hotel, Inc
  ('ChIJSegz5aIpuYkRPpwcmtimGI8', true, null, null, null, 'not a destination (low): Historic hotel (Google: lodging, tourist_attraction); a sight in Berlin but mainly a hotel'),
  -- Heart of the Civil War Heritage Area
  ('ChIJNxdOe1zayYkRG3MVaH674ns', true, null, null, null, 'not a destination (low): Heritage area office (same coordinates as an office)'),
  -- Archaeological Conservancy
  ('ChIJDd-ZUVjayYkRsFTK0wcCGdg', true, null, null, null, 'not a destination (low): Nonprofit office'),
  -- Moran Shipping Agency Inc
  ('ChIJm7bFm_UDyIkRswvEnf_4rWY', true, null, null, null, 'not a destination (low): Listed as a museum but the name is a shipping agency; check before hiding'),
  -- Access Art Inc
  ('ChIJsUq4u8gcyIkRaTDPoW9-xVo', true, null, null, null, 'not a destination (low): Art school and studio; check whether it has a public gallery'),
  -- Art & Remembrance Inc
  ('ChIJx9mcP2LJt4kRGj53gQxcgYU', true, null, null, null, 'not a destination (low): Art business; check whether it has a public gallery'),
  -- Atlantic Arts Inc
  ('ChIJPSacWej2t4kRXufMJ415pXM', true, null, null, null, 'not a destination (low): Art business; check whether it has a public gallery'),
  -- Black Is A Color Inc
  ('ChIJrclcMI8ayIkRlfup54J_5iM', true, null, null, null, 'not a destination (low): Art business; check whether it has a public gallery'),
  -- Bohemian House (Art & Soul)
  ('ChIJL17rlt8fyIkRp8C-Tq9WSTw', true, null, null, null, 'not a destination (low): Google tags it finance; unclear'),
  -- Classic Custom Framing and Gallery Inc.
  ('ChIJHblWYpADuYkRTKiU5EGoQTc', true, null, null, null, 'not a destination (low): A business that sells a service (Google: art_gallery, store)'),
  -- Freeze FX Inc
  ('ChIJMZmbh1Dix4kROBUCHT-cbtw', true, null, null, null, 'not a destination (low): Unclear (Google: night_club); check'),
  -- Manor Mill
  ('ChIJrZIf3WpzyIkR-_ZYd7BY63c', true, null, null, null, 'not a destination (low): Event and art venue; Google also tags it health. Check whether it is open to visitors'),
  -- The Art Den LLC
  ('ChIJ-afQnsq3x4kRs1VwegTp2nQ', true, null, null, null, 'not a destination (low): Art business; check whether it has a public gallery'),
  -- Tony's Garage
  ('ChIJ_dyaGgDdx4kRMWszWZR9oMM', true, null, null, null, 'not a destination (low): Unclear what this is (no Google types we use); check'),
  -- Mt. Airy Fire Company Activities Grounds
  ('ChIJu79OtGEsyIkRIXFLY5vHQic', true, null, null, null, 'not a destination (low): Carnival and event grounds; only open for events'),
  -- Pip Moyer Recreation Center (Annapolis Recreation and Parks)
  ('ChIJQWcsgIn2t4kRCL0Ub363FyI', true, null, null, null, 'not a destination (low): Public rec center and gym; arguably not a "thing to do"'),
  -- Great Wolf Lodge | Perryville
  ('ChIJvdrX1uK5x4kRx7dZUQmjeyY', false, 'Great Wolf Lodge', null, null, 'messy name (high): Clean display name: text after a pipe'),
  -- Splash pad
  ('ChIJZaqJZBDHt4kReW4ckVyDj6I', true, null, null, null, 'messy name (high): Generic name that doesn''t identify a place'),
  -- Spray Pad
  ('ChIJg6RuawADyIkRjV9BfKbGurY', true, null, null, null, 'messy name (high): Generic name that doesn''t identify a place'),
  -- Camp Loop A
  ('ChIJf6VkcADBt4kRAP9JgWOgHKY', true, null, null, null, 'messy name (high): Generic name that doesn''t identify a place'),
  -- Camp Loop B
  ('ChIJAQAtHgDBt4kRsBv6p-XMTg8', true, null, null, null, 'messy name (high): Generic name that doesn''t identify a place'),
  -- Camp Loop D
  ('ChIJXZHvDgDBt4kRuuZgRdmtwEw', true, null, null, null, 'messy name (high): Generic name that doesn''t identify a place'),
  -- Tractor World & Hillcrest River Campground.
  ('ChIJld0R_0SJyokRCrpmQnlN6U8', false, 'Tractor World & Hillcrest River Campground', null, null, 'messy name (high): Clean display name: trailing punctuation'),
  -- Catoctin Furnace Historical Society, Inc.
  ('ChIJ1-kvdvvGyYkRc9tyZw6JayE', false, 'Catoctin Furnace Historical Society', null, null, 'messy name (high): Clean display name: company suffix, pipe or location text removed'),
  -- DEEP CREEK DISCOVERIES
  ('ChIJw_CQ1eKLyokRwVeyLrDZhAY', false, 'Deep Creek Discoveries', null, null, 'messy name (high): Clean display name: all caps'),
  -- Salisbury University Art Galleries | Fulton Hall
  ('ChIJuet6zgkEuYkRbSRwa0fPKZ0', false, 'Salisbury University Art Galleries, Fulton Hall', null, null, 'messy name (high): Clean display name: company suffix, pipe or location text removed'),
  -- The Historic Elk Landing Foundation, Inc.
  ('ChIJERt2RsSlx4kR09kmDZpQgic', false, 'Historic Elk Landing', null, null, 'messy name (high): Clean display name: company suffix, pipe or location text removed'),
  -- BEARWOOD DESIGNS
  ('ChIJmfC2YIbBx4kRMCKupPDel98', false, 'Bearwood Designs', null, null, 'messy name (high): Clean display name: all caps'),
  -- Cecil County Arts Council Inc
  ('ChIJP8FtO12vx4kR88OAgUhnNMc', false, 'Cecil County Arts Council', null, null, 'messy name (high): Clean display name: company suffix, pipe or location text removed'),
  -- Delta Bingo and Gaming, Laurel
  ('ChIJQ1JKwWTdt4kRMUiJ6CCZtZ0', false, 'Delta Bingo and Gaming', null, null, 'messy name (high): Clean display name: location suffix'),
  -- Elk Lanes Inc
  ('ChIJ-7TpLWivx4kR1iz-At045Mk', false, 'Elk Lanes', null, null, 'messy name (high): Clean display name: company suffix, pipe or location text removed'),
  -- Hamilton Gallery | Hamilton Arts Collective
  ('ChIJWUtowu8FyIkRZparsRu-usY', false, 'Hamilton Gallery', null, null, 'messy name (high): Clean display name: company suffix, pipe or location text removed'),
  -- Horseshoe Casino Baltimore - A Caesars Rewards Destination
  ('ChIJ0wy0ekYDyIkRXjZax7r4njA', false, 'Horseshoe Casino Baltimore', null, null, 'messy name (high): Clean display name: marketing text after a dash'),
  -- Main St Gallery Inc
  ('ChIJW9CRGFD2t4kR5t1lI1J1Tcc', false, 'Main St Gallery', null, null, 'messy name (high): Clean display name: company suffix, pipe or location text removed'),
  -- Maryland Art Place Inc
  ('ChIJE6bKKZ0EyIkRlVj0Pta0K0Q', false, 'Maryland Art Place', null, null, 'messy name (high): Clean display name: company suffix, pipe or location text removed'),
  -- SHOOTIN GALLERY
  ('ChIJzWXBSKwouYkRdZ3HfTiohb4', false, 'Shootin Gallery', null, null, 'messy name (high): Clean display name: all caps'),
  -- WALT'S INN
  ('ChIJnT6SJ_UDyIkRDaiPuZocp2E', false, 'Walt''s Inn', null, null, 'messy name (high): Clean display name: all caps'),
  -- WXTERHOUSE STUDIO
  ('ChIJdSEx_5ADyIkRQgpWOyIC0v8', false, 'Wxterhouse Studio', null, null, 'messy name (high): Clean display name: all caps'),
  -- Bollinger Park, Taneytown
  ('ChIJw_UHHQBLyIkRoWy5f_P9GhA', false, 'Bollinger Park', null, null, 'messy name (high): Clean display name: location suffix'),
  -- FLOWERS OVER FREDERICK
  ('ChIJjZ9D-V7ayYkRYe4H2UoGrrU', false, 'Flowers Over Frederick', null, null, 'messy name (high): Clean display name: all caps'),
  -- Garden
  ('ChIJ1YVgt_EDuYkR4ynYPjLbazI', true, null, null, null, 'messy name (high): Generic name that doesn''t identify a place'),
  -- Picnic Area
  ('ChIJY7PEIG0buIkRlGA3Smhyh_w', true, null, null, null, 'messy name (high): Generic name that doesn''t identify a place'),
  -- Historic Downtown Berlin, Maryland, USA
  ('ChIJgeIuJkUnuYkR_3BdHpFnXek', false, 'Historic Downtown Berlin', null, null, 'messy name (medium): Clean display name: company suffix, pipe or location text removed'),
  -- K1 Speed - Indoor Go Karts, Corporate Event Venue, Team Buil
  ('ChIJAxR60M3gt4kRXJJM-dD6GFU', false, 'K1 Speed', null, null, 'messy name (medium): Clean display name: marketing text after a dash ("Indoor Go Karts, Corporate Event Venue, Team Building Activities")'),
  -- LJK Outdoors - Top Chesapeake Bay Charter Fishing Boat, Head
  ('ChIJ_4F4qsF9t4kRHM-hzh0vhJY', false, 'LJK Outdoors', null, null, 'messy name (medium): Clean display name: marketing text after a dash ("Top Chesapeake Bay Charter Fishing Boat, Headboat Fishing, Sunset & Booze Cruises & Tours - Solomons Maryland")'),
  -- The Boardwalk, Ocean City, MD
  ('ChIJmRoy90MouYkRW4vJbEAKSfk', false, 'Ocean City Boardwalk', null, null, 'messy name (medium): Clean display name: company suffix, pipe or location text removed'),
  -- mt stadium
  ('ChIJTzX6EADLt4kRrbQNCHauVNA', true, null, null, null, 'messy name (medium): Lowercase name, no reviews, listed as a museum in Bethesda; cannot tell what it is'),
  -- Play Street Museum - Gaithersburg
  ('ChIJjQNIhawttokRwtfXwZYI8F0', false, 'Play Street Museum Gaithersburg', null, null, 'messy name (medium): Clean display name: company suffix, pipe or location text removed'),
  -- baked clay studio
  ('ChIJPb7RJFnayYkRHjOGeRiGbMs', false, 'Baked Clay Studio', null, null, 'messy name (medium): Clean display name: all lowercase'),
  -- foraged. a hyper-seasonal eatery
  ('ChIJHU9sANgEyIkRm9Y9Ka0TuPQ', false, 'Foraged', null, null, 'messy name (medium): Restaurant name with a tagline (step 3 may hide restaurants anyway)'),
  -- holy hands productions
  ('ChIJi1TSegrBx4kRJFog0fUm8PQ', false, 'Holy Hands Productions', null, null, 'messy name (medium): Clean display name: all lowercase'),
  -- Preston Shurley | An Art Gallery
  ('ChIJ-9yDVFkDyIkRg0S-lSN-Ofg', false, 'Preston Shurley Gallery', null, null, 'messy name (medium): Text after a pipe'),
  -- SU Art Galleries | Downtown
  ('ChIJy5bwzsEDuYkRMr3iE0uyVpE', false, 'Salisbury University Art Galleries, Downtown', null, null, 'messy name (medium): Abbreviation and text after a pipe'),
  -- (1) HILLCREST RIVER CAMPGROUND (2) CANAL TUNNEL RIVER CAMPGR
  ('ChIJ0S7KM-yJyokRBi8TePfpDno', false, 'Hillcrest River and Canal Tunnel River Campgrounds', null, null, 'messy name (low): Two campgrounds in one listing; a clean name is a guess'),
  -- Inside Them Gates Court | Separate Yourself Mural
  ('ChIJI0Zxvo3lt4kRKrj4D4hjwk8', false, 'Separate Yourself Mural', null, null, 'messy name (low): Text after a pipe; unclear which part is the place')
on conflict (place_id) do nothing;

-- Remember what each row had, then apply
update public.maryland_attraction_overrides o
set previous_category = a.category,
    previous_duplicate_of = a.duplicate_of,
    previous_is_pseo_eligible = a.is_pseo_eligible
from public.maryland_attractions a
where a.place_id = o.place_id and o.previous_is_pseo_eligible is null;

select public.apply_attraction_overrides();
select public.refresh_attraction_breweries();
