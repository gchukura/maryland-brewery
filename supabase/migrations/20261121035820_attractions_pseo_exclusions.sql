-- Attractions that pass the google_types filter in 20261121035119_attractions_pseo_eligibility
-- but must not get pages. Runs after it, so re-running both keeps these ineligible.
-- Keyed by Google place_id (stable across re-imports). Add new exclusions here.
update public.maryland_attractions set is_pseo_eligible = false
where place_id in (
  -- not public: private, member, scout, military or residential
  'ChIJm21LhQQRyIkReaUVTzlEH2o', -- Gramercy Mansion (B&B and event venue)
  'ChIJTzlIcqrtx4kRwPRYnoTRNkk', -- YMCA Camp Tockwogh
  'ChIJKdZtT7Pxt4kRwP-MKQuz-po', -- Elks Camp Barrett
  'ChIJ6fgHsSzKx4kRIXLo-gJj69Y', -- Camp Horseshoe, Horseshoe Scout Reservation
  'ChIJT-lwstXlt4kRo64mUWVgM1E', -- Camp Meade RV Park (Fort Meade)
  'ChIJO1eYNS_YuIkRMApnTCCOhgk', -- White Horse Park Community Association
  -- coordinates outside Maryland
  'ChIJk7j9VrHbtYkRTRP4-BfnLkI', -- Appalachian National Scenic Trail (point in Virginia)
  'ChIJv2QNBtYVtYkREwqtQOsaeq4'  -- Brighton Park (West Virginia)
);
