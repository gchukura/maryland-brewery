# Scripts

The maintenance scripts live in `scripts/*.ts` and run with `tsx` through the npm scripts in `package.json`. Older one-off scripts were removed on 2026-10-28 (they are in git history; see the last section).

## Before you run anything

- **Environment.** Most scripts load `.env.local` themselves with `dotenv` (`config({ path: '.env.local' })`), so you do not need to export anything in your shell. There are three exceptions. `seo:count-urls` does not load `.env.local`. `indexnow` and `lint:links` read no environment variables.
- **Writes go to the production database.** There is no separate staging Supabase project. Any script marked "Writes DB: yes" changes live data the moment it runs. Use `--dry-run` where a script offers it.
- **Writes need `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.** Writes go through `supabaseAdmin` in `src/lib/db/client.ts`, which is only created when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are both set. Some scripts check for the key at startup. The others fail later with an unclear error (for example `supabaseAdmin.from is not a function`), because `supabaseAdmin` is a Proxy, so the `if (!supabaseAdmin)` guards in the code never fire.
- **Reads through `getBreweryDataFromSupabase()` use the anon client.** Any script that loads breweries through `src/lib/db/queries.ts` also needs `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The per-script sections below say which scripts do.
- **Google key.** Scripts that call Google APIs use only `GOOGLE_MAPS_API_KEY`, a server key (`scripts/lib/google.ts`, setup in [setup.md](setup.md#google-server-key)). They never fall back to the site's browser key, which Google refuses from scripts. Check it with `npm run google:check`.
- `NODE_ENV` is read in `src/lib/db/queries.ts`, but only to turn on extra logging.

## Summary

| npm script | Purpose | Writes DB? |
|---|---|---|
| `data:reviews:google` | Fetch Google rating and up to 5 reviews per brewery (stored `place_id` only) | yes |
| `data:reviews:yelp` | Fetch Yelp rating and up to 3 reviews per brewery and store Yelp business IDs | yes |
| `data:reviews:themes` | Keyword-analyze stored reviews into `breweries.review_themes` | yes |
| `data:reviews:dedupe` | Delete duplicate rows from `reviews` | yes (deletes) |
| `data:reviews:counts` | Report review counts per brewery | no |
| `data:news` | Fetch Google News RSS articles into `brewery_articles` | yes |
| `google:check` | Check `GOOGLE_MAPS_API_KEY` against every Google API the scripts use | no |
| `data:check-websites` | Check every brewery `website` still loads and belongs to that brewery, and list junk social links (read-only) | no |
| `data:logos` | Fetch logos, upload them to Storage (`brewery-media/logos/`) and set `breweries.logo` | yes |
| `data:photos` | Download Google Places photos, upload them to Storage (`brewery-media/photos/`) and set `breweries.photos` | yes |
| `media:migrate` | Move existing `public/photos` and `public/logos` into Storage and repoint the rows (dry run unless `--apply`) | with `--apply` |
| `data:geocode` | Re-geocode every brewery and overwrite lat/lng that moved by more than 0.01 degrees | yes |
| `data:verify-coordinates` | Compare stored coordinates with Google geocoding and report differences | no |
| `data:beers` | Import beers from a CSV of the data sheet's beers tab, replacing each listed brewery's beers | with `--apply` |
| `data:verify-hours` | Compare stored hours with Google's; mark matches verified (`hours_verified_at`) | with `--apply` |
| `data:places` | Fill blank hours, website, phone and street from Google Place Details (stored `place_id`); report differences and wrong place IDs; optionally take Google's values and fix place IDs | with `--apply` |
| `data:enrich` | Fill missing social links (from brewery websites) and hours (from Google) | yes |
| `data:enrich:amenities` | Infer missing amenity flags from review text | yes |
| `data:attractions` | Fetch Maryland attractions from Google Places into `maryland_attractions` | yes |
| `seo:count-urls` | Estimate the number of sitemap URLs (currently broken, see below) | no |
| `indexnow` | Submit live sitemap URLs to IndexNow (all, or only new ones; runs after each production deploy) | no |
| `lint:links` | Statically check internal `href`s against `src/app` routes (runs in CI) | no |
| `seo:check` | Crawl every sitemap URL of a running build: status, redirects, canonical, noindex, title/description length | no |
| `seo:fixture` | Refresh the real-name snapshot the page-title test uses | no |

---

## Reviews

### `npm run data:reviews:google`

File: `scripts/fetch-google-reviews.ts`

What it does: Loads all breweries. For each one with a stored `place_id` it calls Place Details for `reviews,rating,user_ratings_total`. New reviews are inserted into `reviews` with `source='google'`, skipping any that match an existing review on timestamp, reviewer name and the first 100 characters of text. It also updates `google_rating`, `google_rating_count` and `google_reviews_last_updated` on `breweries`. Breweries whose `google_reviews_last_updated` is less than 7 days old are skipped. Breweries without a `place_id` are skipped: link them with `npm run data:places -- --relink`, which checks that the place is the brewery (the old first-search-result lookup saved other businesses' place IDs). The Places API returns at most 5 reviews per place, so the reviews table grows slowly over repeated runs.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (brewery read), `SUPABASE_SERVICE_ROLE_KEY` (writes), `GOOGLE_MAPS_API_KEY` (server key; required, it throws without one). Google Cloud needs Places API Place Details enabled.
- Writes to Supabase: **yes**. Inserts into `reviews` and updates `google_rating`, `google_rating_count` and `google_reviews_last_updated` on `breweries`.
- Flags: `--slug=a,b` runs only those breweries and ignores the 7-day skip.
- How often: weekly. Running it more often only re-skips breweries.

### `npm run data:reviews:yelp`

File: `scripts/fetch-yelp-reviews.ts`

What it does: For each brewery it finds a Yelp business with the Fusion business search (name + "city, state"), stores `yelp_business_id`, and fetches the business details and the reviews endpoint (Yelp returns at most 3 reviews). It inserts the reviews into `reviews` with `source='yelp'`, using the same duplicate filter as the Google script. It also updates `yelp_rating`, `yelp_rating_count` and `yelp_reviews_last_updated`. It stops early on a Yelp authentication or rate-limit error.

**Known bug:** the script reads `brewery.yelp_reviews_last_updated` and `brewery.yelp_business_id` (snake_case). The objects returned by `getBreweryDataFromSupabase()` use camelCase (`yelpReviewsLastUpdated`, `yelpBusinessId`), so both checks are always empty. As a result, the intended 7-day skip never happens, and the stored business ID is never reused. Every run searches Yelp again for every brewery.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (brewery read), `SUPABASE_SERVICE_ROLE_KEY` (writes), `YELP_API_KEY` (required; it throws without it).
- Writes to Supabase: **yes**. Inserts into `reviews` and updates `yelp_business_id`, `yelp_rating`, `yelp_rating_count` and `yelp_reviews_last_updated` on `breweries`.
- Flags: none.
- How often: weekly at most. Because of the bug above, each run makes about 3 Yelp calls per brewery, against the free tier's 5,000 calls per day.

### `npm run data:reviews:themes`

File: `scripts/analyze-and-store-review-themes.ts`

What it does: For each brewery it reads every row in `reviews` with non-null text (Google and Yelp), runs regex keyword patterns for beer quality, food and menu, service and staff, atmosphere, and amenities, and writes the result as JSON to `breweries.review_themes`. It does not call an external API or LLM. Breweries with no reviews are skipped. The existing `review_themes` value is overwritten.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Writes to Supabase: **yes**. Updates `breweries.review_themes`.
- Flags: `--brewery-id=<uuid>` processes one brewery.
- How often: after each review fetch (weekly, after `data:reviews:google` / `data:reviews:yelp`).

### `npm run data:reviews:dedupe`

File: `scripts/remove-duplicate-reviews.ts`

What it does: Reads every row of `reviews` (paginated, 1,000 at a time) and groups rows by `brewery_id` + `source` + `review_timestamp` + lowercased `reviewer_name`, the same columns as the reviews unique constraint in `supabase/migrations/20261027000000_reviews_unique.sql`. In each group it keeps the row with the earliest `created_at` and deletes the rest, in batches of 50. Run it (dry run first) before applying that migration.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Writes to Supabase: **yes, it deletes rows** from `reviews`.
- Flags: `--dry-run` lists the first 10 groups and the counts without deleting anything. Always run this first.
- How often: as needed, when `data:reviews:counts` or the site shows repeated reviews. The fetch scripts already skip duplicates on insert.

### `npm run data:reviews:counts`

File: `scripts/check-review-counts.ts`

What it does: Reads `reviews` and prints the review count per brewery (top 20, and every brewery with more than 5). It also prints a "duplicate reviews" section, but that section is wrong. The query only selects `brewery_id, brewery_name, id`, so `review_timestamp` and `reviewer_name` are always missing, and every brewery with two or more reviews shows up as a duplicate. Use `data:reviews:dedupe --dry-run` to check for real duplicates. Its read is unpaginated, so it only sees the first 1,000 reviews.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. It creates its own client and exits if either is missing.
- Writes to Supabase: **no** (read only).
- Flags: none.
- How often: as needed, for diagnostics.

---

## Brewery content

### `npm run data:news`

File: `scripts/fetch-brewery-news.ts`

What it does: For each brewery it queries Google News RSS for `"<name>" Maryland brewery` (no API key), scores each article from 0 to 1, keeps articles that score above 0.4, and upserts the top 10 into `brewery_articles` (conflict on `brewery_id,url`). Scoring starts at 0.5 and adds points when the name is in the title or description, the source is a Maryland outlet, or the text has beer keywords. It subtracts points for articles older than a year. It then sets `breweries.articles_last_updated`. Breweries whose `articles_last_updated` is within the last 7 days are skipped unless you pass `--force`. `articles_last_updated` is only set when at least one article was saved, so breweries with no news are queried again on every run. It waits 1 second between breweries.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (brewery read), `SUPABASE_SERVICE_ROLE_KEY`. The service key is needed for writes, and also for the 7-day check, which reads `articles_last_updated` through the admin client, so `--dry-run` without `--force` still needs it.
- Writes to Supabase: **yes**. Upserts into `brewery_articles` and updates `breweries.articles_last_updated`. Nothing is written with `--dry-run`.
- Flags:
  - `--dry-run` prints the articles that would be saved.
  - `--force` ignores the 7-day skip.
  - `--limit=N` processes only the first N breweries. It must use `=`. The `--limit 10` form shown in the file's header comment is silently ignored.
  - `--brewery=<name>` keeps breweries whose name contains the text (case-insensitive). It must use `=`, for example `--brewery="Flying Dog"`. The `--brewery "Name"` form in the header comment does not work.
  - Pass flags through npm with `--`, for example `npm run data:news -- --dry-run --limit=5`.
- How often: weekly.

### `npm run data:logos`

File: `scripts/fetch-brewery-logos.ts`

What it does: Finds breweries whose `logo` is empty or an external `http(s)` URL. External URLs (other than our own Storage bucket) are downloaded, converted to WebP (max 512px, keeping transparency) and uploaded to `brewery-media/logos/<slug>.webp`. For breweries with no logo, it scrapes the Brewers Association of Maryland members page (`marylandbeer.org/brewing-companies/current-members/`) and matches names exactly, then by partial match, then after stripping "Brewing/Brewery/Company" suffixes. If that fails, it looks for a logo on the brewery's own website. It sets `breweries.logo` to the Storage URL. Breweries it could not resolve are listed in `scripts/output/brewery-logos-missing.md` (gitignored). It replaces an existing object at the same path.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (brewery read), `SUPABASE_SERVICE_ROLE_KEY` (writes).
- Writes to Supabase: **yes**. Updates `breweries.logo`. It also uploads to Supabase Storage and writes a report in `scripts/output/` (gitignored). Needs `SUPABASE_SERVICE_ROLE_KEY` and the `brewery-media` bucket.
- Flags: none.
- How often: after adding breweries.

### `npm run data:photos`

File: `scripts/download-google-photos.ts`

What it does: For every brewery with a stored `place_id` (others are skipped; link them with `npm run data:places -- --relink`) it gets the photo references from Place Details and downloads up to 11 photos per brewery, converts them to WebP (max 1600px, quality 80) and uploads them to `brewery-media/photos/<slug>/<n>.webp`. Photos already in Storage are not downloaded again. The new URLs are merged into `breweries.photos` without removing the old ones. It calls Place Details for every brewery on every run, even if all its photos are already in Storage.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (all reads and writes use the admin client), `GOOGLE_MAPS_API_KEY` (server key, required).
- Writes to Supabase: **yes**. Updates `breweries.photos`. It also uploads to Supabase Storage. Needs `SUPABASE_SERVICE_ROLE_KEY` and the `brewery-media` bucket.
- Flags: `--slug=a,b` runs only those breweries.
- How often: after adding breweries. Each run costs Google Places calls for every brewery.

### `npm run data:places`

File: `scripts/fill-from-places.ts` (logic in `scripts/lib/places-fill.ts`)

What it does: For every brewery with a `place_id`, it calls Place Details (name, business status, location, hours, website, phone, address). It fills blank `hours`, `website`, `phone` and `street`. Filled fields that differ from Google are reported: coordinates more than 0.1 miles apart, hours (compared by parsed times), website host, phone digits and street (ignoring abbreviations and suites). A place is treated as a wrong `place_id`, and nothing from it is used, when its name doesn't match the brewery's (the city in our name is ignored, and a shared website also counts as a match) or when it is more than 1 mile from our coordinates (another location of the same brewery). Closed places and invalid place IDs are listed and left alone. Hours written from Google get `hours_verified_at`. The report prints and is written to `scripts/output/places-report.md`.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_MAPS_API_KEY` (server key).
- Writes to Supabase: only with `--apply`. Run the Sync workflow afterwards.
- Flags: `--apply` writes the fills. `--overwrite` also replaces the differing values with Google's. `--relink` text-searches Google for breweries with a wrong or missing `place_id` and saves the nearest result whose name matches within 25 miles; if none matches, it clears the wrong `place_id` (it drives the Directions link). Run without `--apply` first and read the report.
- How often: after adding breweries, or every few months. One Place Details call per brewery, plus a Text Search per relinked brewery.

### `npm run data:enrich`

File: `scripts/enrich-supabase-breweries.ts`

What it does: For breweries with no social links, it fetches the brewery website and extracts the first Facebook, Instagram, Twitter/X and Untappd links. For breweries with no hours, it runs a Places Text Search and a Place Details (`opening_hours`) lookup. It only updates `social_media` and `hours` when something changed, and never overwrites existing values. The Google lookup does not save the `place_id` it finds.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (brewery read), `SUPABASE_SERVICE_ROLE_KEY` (writes), and optionally `GOOGLE_MAPS_API_KEY` (server key). Without it, the hours step is skipped.
- Writes to Supabase: **yes**. Updates `breweries.social_media` and `breweries.hours`.
- Flags: none.
- How often: after adding breweries.

### `npm run data:enrich:amenities`

File: `scripts/enrich-amenities-from-reviews.ts`

What it does: For each brewery it concatenates the text of its English (`language='en'`) reviews, from any source, and uses keyword heuristics to infer `allows_visitors`, `offers_tours`, `beer_to_go`, `has_merch`, `dog_friendly`, `outdoor_seating`, `food` ("In-House" / "Food Trucks"), `other_drinks` and `parking` ("yes"/"no"). It only fills fields that are currently empty or false. It never overwrites a set value and never sets anything back to false.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (checked at startup).
- Writes to Supabase: **yes**. Updates those amenity columns on `breweries`.
- Flags: none.
- How often: after review fetches, or after adding breweries. Because heuristic positives are permanent, check the output.

---

## Location data

### `npm run data:geocode`

File: `scripts/geocode-breweries.ts`

What it does: For every brewery it gets coordinates from Places Text Search (name, city, state), and falls back to the Geocoding API with the full address, retrying twice. If the result differs from the stored latitude or longitude by more than 0.01 degrees (about 0.6 miles), it overwrites the stored coordinates. Breweries with no stored coordinates always count as changed. There is no review step: it updates every brewery that moved.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (checked at startup), `GOOGLE_MAPS_API_KEY` (server key, required).
- Writes to Supabase: **yes**. Updates `breweries.latitude` and `breweries.longitude`.
- Flags: none.
- How often: after adding breweries or changing addresses. Run `data:verify-coordinates` first to see what would change.

### `npm run data:verify-coordinates`

File: `scripts/verify-brewery-coordinates.ts`

What it does: Geocodes each brewery's name and address with the Geocoding API and prints the distance from the stored coordinates. It counts more than 0.1 mile as a warning and more than 1 mile as an error. Breweries with no stored coordinates are reported and skipped. It geocodes each brewery twice (once for the detail output, once for the summary), so it costs twice as many API calls as needed.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (checked at startup, even though it only reads), `GOOGLE_MAPS_API_KEY` (server key, required).
- Writes to Supabase: **no** (read only).
- Flags: one optional positional argument, a brewery name substring (`ilike '%name%'`), for example `npm run data:verify-coordinates -- "Silly Yak"`. With no argument it checks all breweries.
- How often: as needed. Run it before `data:geocode`, or when a map pin looks wrong.

### `npm run data:beers`

File: `scripts/import-beers.ts` (parsing in `scripts/lib/beers-csv.ts`)

What it does: Reads a CSV with the columns `brewery_id, beer_name, beer_style, beer_abv, beer_availability` (`name`, `style`, `abv` and `availability` also work), such as the beers tab of the data sheet downloaded with File > Download > Comma-separated values. For every brewery in the file, it replaces that brewery's rows in `beers` with the file's. Breweries not in the file keep their beers. It skips rows with an unknown `brewery_id`, rows without a name, and repeated beers (same brewery, same name ignoring case). An ABV that isn't a number (such as "TBD") and "Unknown" availability are stored empty, because the brewery page shows ABV with a "%". It prints what will be added and removed before writing.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Writes to Supabase: only with `--apply`. Run the Sync workflow afterwards.
- Usage: `npm run data:beers -- ~/Downloads/beers.csv`, then the same with `--apply`.
- How often: whenever the beers tab changes.

### `npm run data:verify-hours`

File: `scripts/verify-hours.ts`

What it does: Fetches each brewery's opening hours from Place Details (`place_id`) and compares them with `breweries.hours` by parsed open times (`src/lib/hours.ts`), so spacing and AM/PM placement don't count as differences. It prints every brewery whose hours differ, day by day. It also lists those it couldn't check: Google lists no hours, the place isn't `OPERATIONAL`, or there's no `place_id`. With `--apply` it sets `hours_verified_at` on the matches. The brewery page then shows "Hours checked against Google {month}" under the hours. A database trigger clears `hours_verified_at` whenever `hours` changes any other way (sync, `data:enrich`, a manual edit).

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_MAPS_API_KEY` (server key, required). It stops on the first `REQUEST_DENIED`.
- Writes to Supabase: only with `--apply`.
- Flags: `--apply`; `--take-google=slug-a,slug-b` (needs `--apply`) replaces those breweries' hours with Google's and marks them verified. A difference is a lead, not a verdict: Google can be the stale one, so pick the slugs after reading the report. It refuses a slug whose hours don't differ.
- How often: monthly, and after adding breweries. The month on the page is only as fresh as the last run.

### `npm run data:attractions`

File: `scripts/fetch-maryland-attractions.ts`

What it does: Builds a list of brewery cities, using the first brewery's coordinates for each city (not an average, despite the old README). For each city it runs Places Nearby Search (10 km radius) for about 20 Google place types. It then runs a coarse grid search across Maryland (0.5 degree spacing, 25 km radius, 5 key types, capped at 500 requests). Each new place gets a Place Details call. Places outside Maryland are dropped. The rest are mapped to a category (landmark, museum, park, entertainment, shopping, restaurant) and upserted into `maryland_attractions` on `place_id`. It waits 200 ms between requests.

- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (brewery read), `SUPABASE_SERVICE_ROLE_KEY` (writes), `GOOGLE_MAPS_API_KEY` (server key, required). Google Cloud needs Places API Nearby Search and Place Details enabled.
- Writes to Supabase: **yes**. Upserts into `maryland_attractions`. Nothing is written with `--dry-run`.
- Flags:
  - `--dry-run` skips the upsert. It still makes all the Google API calls, including Place Details, so it is not free.
  - `--city=<name>` searches one city (case-insensitive) and skips the grid search.
  - `--type=<category>` keeps only one of the mapped categories (`landmark`, `museum`, `park`, `entertainment`, `shopping`, `restaurant`), not a raw Google type. In the grid search the filter is applied after the Place Details call.
- How often: rarely, for example a few times a year. One full run makes a few thousand Places calls.

---

## SEO and site checks

### `npm run seo:count-urls`

File: `scripts/count-sitemap-urls.ts`

What it does: Meant to print a breakdown of how many URLs the sitemap should contain (static, region, city, county, brewery, type, amenity, city + amenity, neighborhood and attraction pages). Some counts are hard-coded (8 static pages, 4 attraction pages) and may have drifted from `src/app/sitemap.ts`.

**Currently broken outside Next.** It calls `getProcessedBreweryData`, `getAllCities`, `getAllTypes` and `getAllAmenities` from `src/lib/db/brewery-data.ts`. Those are wrapped in `unstable_cache` from `next/cache`, which throws "incrementalCache missing" when called from a plain `tsx` process. The script catches the error with `main().catch(console.error)` and exits with code 0, so the failure is easy to miss. It also does not load `.env.local`. To count URLs today, fetch the deployed `/sitemap.xml` and count the `<loc>` entries.

- Env: none read directly. Through `src/lib/db/client.ts` it would need `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which must already be in the shell because the script does not load `.env.local`.
- Writes to Supabase: **no**.
- Flags: none.
- How often: as needed, once it is fixed.

### `npm run indexnow`

File: `scripts/submit-indexnow.ts`

What it does: Checks that the IndexNow key file `https://www.marylandbrewery.com/457bccd4eef437d8877d15d3e947fa02.txt` is reachable (it is served from `public/`). It then fetches the live `https://www.marylandbrewery.com/sitemap.xml` and POSTs every URL to `api.indexnow.org` in batches of up to 10,000. Bing and Yandex use IndexNow; Google does not. The host and key are hard-coded. Because it reads the live sitemap, it only submits what is already deployed.

- Env: none.
- Writes to Supabase: **no**. It makes an external POST to IndexNow.
- Flags: `--previous <file>` submits only sitemap URLs missing from that JSON list (every URL if the file does not exist). `--save <file>` writes the current sitemap URLs there after a successful submission. It exits with code 1 if any batch fails.
- How often: automatically. `.github/workflows/indexnow.yml` runs it with both flags after every successful production deploy, so each deploy submits only new pages (it keeps the URL list as an Actions artifact). Pages whose content changed are not resubmitted; the sitemap's `lastmod` is the build time, so it cannot tell them apart. Run it by hand, with no flags, only to resubmit everything after a large content change. Do not do that often, because IndexNow can rate-limit (HTTP 429).

### `npm run lint:links`

File: `scripts/validate-internal-links.ts`

What it does: Builds the route list from `page.tsx` / `page.ts` files under `src/app`, treating `[param]` folders as wildcards. It then scans every `.ts` / `.tsx` file in `src/` for literal `href="/..."`, `href={'/...'}` and template-literal hrefs. Each one must match a route, a special route (sitemap, robots, `/api/`, OG images) or a file in `public/`. Template literals with `${...}` are reported as warnings. It exits with code 1 if any link is invalid.

- Env: none.
- Writes to Supabase: **no**. It does not touch the network or the database.
- Flags: none.
- How often: on every change. It runs in CI (`.github/workflows/ci.yml`). For a crawl of the deployed site, use `npm run lint:links:deployed` (linkinator).

---

## Removed scripts

The 25 one-off scripts that lived in `scripts/archived/` (membership enrichment, CSV imports, image fetchers, logo tools, early data fixes) were deleted on 2026-10-28 as part of the launch dead-code pass. Nothing ran them. To read one, look in git history, e.g. `git log --diff-filter=D --name-only -- scripts/archived`.
