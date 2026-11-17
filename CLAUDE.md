# CLAUDE.md

Maryland brewery directory (marylandbrewery.com). Read this before changing anything.
Docs live in docs/ (setup, scripts, troubleshooting, seo-audit-2026, adsense). When docs and code disagree, trust the code.

## Stack
- Next.js 15.5 App Router, React 19, TypeScript (`strict: true`).
- Tailwind CSS v4 via `@tailwindcss/postcss`. Theme lives in `@theme` in `src/app/globals.css`.
- Supabase Postgres is the only data store. Schema migrations in `supabase/migrations/`.
- npm (package-lock.json), Node 22 (`engines.node: 22.x`). Deployed on Vercel (`vercel.json`, region iad1).
- Google Maps via `@vis.gl/react-google-maps`. AdSense (`src/components/ads/`).
- Path alias `@/*` maps to `src/*`.

## Decisions (made 2026-10-27; do not revisit without asking)
- Supabase stays the source of truth. No Google Sheets data layer.
- Neighborhood pages are kept and rebuilt at `/neighborhoods/[slug]`, looked up by the
  `maryland_neighborhoods.slug` column, with data-driven content (breweries sorted by distance,
  nearby attractions). Noindex any neighborhood with no brewery within 3 miles.
- `/best-breweries/[city]` exists only for cities with 5+ breweries. County, region and `near/`
  variants 301 to their main pages.
- Images live in Supabase Storage (public bucket `brewery-media`), not in `public/`.
- No admin web UI. Data sync is triggered by a GitHub Action calling `/api/sync` with a secret
  (`.github/workflows/sync.yml`, run manually; needs `SITE_URL` variable and `ADMIN_SYNC_TOKEN` secret).
- Ads: one footer unit site-wide, one 300x250 slot in the brewery page right rail.
  Reserved heights, no ad-block detection.
- No blog until posts exist.
- Visual design: `docs/design/` is the source of truth (`tokens.css`, `mark.svg`, `mark-mono.svg`,
  `artboards/`). Fraunces for display, Inter for UI. Flag palette:
  - ink `#141414`
  - flag gold `#EAAA00`: fills and "open now" only, always black text
  - flag red `#E03A3E`: bands and motifs only
  - deep red `#B3121B`: buttons, links
  - cream `#F5EFE0`, paper `#FFFDF7`
- Counts and brewery details in the artboards are illustrative; always compute from data.

## Current state (gaps between the code and the decisions above)
These describe the code as of 2026-10-27. Fix them in their own PRs, not incidentally.
- `src/app/api/contact/route.ts` still appends to a Google Sheet via `googleapis`.
- Neighborhood rules (radii, noindex, attraction filter) live in `src/lib/neighborhoods.ts`; the 5+
  best-of rule lives in `src/lib/best-breweries.ts`. Old `{neighborhood}-{city}-md` URLs under
  `/best-breweries`, `/best-breweries/near` and `/cities/near` redirect to `/neighborhoods/[slug]`.
- `/near/[slug]` is attraction pages, not neighborhoods.
- Redirects: pattern-only ones (-md, amenity aliases) are 301s in `src/middleware.ts`; ones that need data
  (city size, neighborhoods, brewery ids) use `permanentRedirect()` in the page, which sends 308.
- `/blog` temporarily redirects to `/`.
- Design system is in place: tokens in `@theme` in `globals.css`, Fraunces + Inter via next/font
  (`font-display`, `font-sans`), shared UI in `src/components/ui/` (Button, Chip/FilterChip, StatusBadge,
  BreweryCard, BreweryListRow, Breadcrumbs, CheckerBand, SectionHeading, Logo), header/footer in
  `src/components/layout/`. Listings, the brewery page and the homepage use them; text pages (faq, terms, contact...) use
  `src/components/layout/ContentPage.tsx` (`.prose-page` styles); browse indexes use `PageHeader` + `IndexCard`/`GroupedLinks`.
- Every brewery listing (cities, counties, regions, amenities, types, city x amenity, best-of, open now,
  neighborhoods, /near, /map) is `src/components/listing/ListingPage.tsx` (server) + `BreweryListMap.tsx`
  (client island). Filters live in the URL and run in the browser on the static list (`src/lib/listing.ts`);
  canonical URLs stay unfiltered. The one map is `src/components/maps/BreweryMap.tsx` (load it via
  `BreweryMapLazy`); it needs `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. Site search: `/search-index.json` +
  `src/components/search/SearchCombobox.tsx`.
- The brewery page (`src/app/breweries/[slug]/page.tsx`) is a server component; its derivations are in
  `src/lib/brewery-page.ts`, islands in `src/components/brewery/`. Saved breweries: `src/lib/saved.ts`, `/saved`.
  "Hours checked against Google {month}" shows only when `hours_verified_at` is set (`npm run data:verify-hours`; a trigger
  clears it when hours change).
- Homepage: `src/app/page.tsx` (revalidate 300), hero photos in `src/config/home.ts` (`npm run home:blur` after
  editing), county map `src/components/home/CountyMap.tsx` from `maryland-counties.svg` (`npm run map:counties`).
  The phone tab bar (`src/components/layout/BottomNav.tsx`) is site-wide below 768px.
- Tailwind v4: `row-span-*`/`col-span-*` set the whole `grid-row`/`grid-column` shorthand and can override a
  `row-start-*` from another breakpoint; use `row-end-*` with `row-start-*` instead.
- Ads: rules in `src/lib/ads.ts` (no ads on /contact, /add-brewery, /saved; error and 404 pages call
  `suppressAds()`). `AdSenseLoader` adds the script after load + 3 s idle or first interaction; verification is the
  `google-adsense-account` meta tag. Ad units must be fixed-size (no `data-ad-format`): AdSense collapses the
  parents of unfilled responsive units with inline `!important` styles.
- Accessibility: `e2e/a11y.spec.ts` (axe) must stay at zero serious/critical violations.
- Internal links: the footer links every region, amenity, type and eligible best-of city; `/neighborhoods` and `/near`
  index every indexed neighborhood and attraction. `npm run seo:check` also crawls from `/` and fails on orphans,
  links to redirects and broken links. Launch QA results and post-deploy steps: `docs/launch.md`. `npx knip` must stay clean (`knip.json`).
- `cn()` is plain clsx (no tailwind-merge): never pass a class that conflicts with a component's base class;
  add a variant instead.
- Brewery photos and logos are in Storage; `public/photos` and `public/logos` were purged from git history on
  2026-10-28 (`docs/runbooks/rewrite-history.md`). `public/cities/`, `counties/`, `regions/` remain.
- Logo assets are generated from `docs/design/mark.svg` with `npm run icons`.
- All shared helpers exist. Metadata: `buildMetadata` + `src/lib/seo/page-meta.ts` (titles ≤ 60 with the
  ' | Maryland Brewery' suffix, tested over real names); JSON-LD: `src/lib/seo/jsonld.ts`.
  `npm run seo:check` crawls the sitemap of a running build and must report 0 problems.
- No `as any` in `src`; about a dozen `any` annotations remain (`npm run lint` warns on each).

## Conventions
- Server components by default. `"use client"` only for interactive islands, kept small.
- All Supabase access goes through `src/lib/db`; import from `@/lib/db` only (ESLint enforces it).
  Row types are generated (`Tables<'breweries'>`); run `npm run db:types` after any migration.
  The raw clients are private to that folder. Scripts in `scripts/` import its files directly.
- No `as any`. No hex colors in className; use theme tokens.
- Shared helpers live in one place: `src/lib/geo.ts`, `hours.ts`, `slug.ts`, `amenities.ts`, `seo/`.
- One PR per task. Before opening a PR run: `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run build` (and `npm run test:e2e` for UI changes). CI runs all but e2e. Include in the PR description what changed,
  how it was verified, and anything left undone.
- Never commit secrets, `.env` files, or generated images into `public/`.

## Known traps
- `unstable_cache` JSON-serializes return values; never cache `Map` or `Set`.
- `next/font` exposes fonts only through CSS variables; never reference a font by its family name.
- Tailwind v4 ignores `tailwind.config.ts` unless `@config` is used; tokens go in `@theme` in `globals.css`.
- Hours strings use an en-dash and often omit AM/PM on the opening time; parse only with `src/lib/hours.ts`,
  which also evaluates "now" in Maryland time (the server runs in UTC).
- Two Google keys: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is the domain-restricted browser key (maps only; a 403 from
  any server, including `/_next/image`). Scripts use only the server key `GOOGLE_MAPS_API_KEY` via `scripts/lib/google.ts`;
  `npm run google:check` tests it. Never put the server key in a stored URL.
- No `loading.tsx` above a page that calls `notFound()` or `permanentRedirect()`: the loading boundary streams a
  200 first, so 404s become soft 404s and redirects become meta refreshes. `seo:check` probes for this (`STATUS_PROBES`).
- Data reads throw on any error (`readError`), at build and at runtime; never catch and return []/null.
  Empty data during a build ships empty pages; at runtime ISR caches the empty page or 404 (the Nov 2026
  egress-quota outage 404'd every brewery page). Throwing keeps the last good page. `server-only` is imported in `src/lib/db/index.ts`, not `client.ts`,
  because scripts import the db files directly.
