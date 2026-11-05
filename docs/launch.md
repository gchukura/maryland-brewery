# Launch QA

Run on 2026-10-28 against a local production build of `seo/linking-qa` (`npm run build && npx next start -p 3100`), with production Lighthouse numbers from www.marylandbrewery.com, which already serves the rebuild. Rerun every check here against the PR's Vercel preview before you call the launch done (see [Rerunning](#rerunning)).

## SEO check and orphan check

`npm run seo:check -- http://localhost:3100` fetches every sitemap URL and checks it (status 200, no redirect, self-canonical, indexable, title ≤ 60, description ≤ 155). It then crawls internal links from the homepage. It reports orphans (sitemap pages nothing links to), links to redirects, and links to pages that return 4xx/5xx.

```
Checking 1975 sitemap URLs against http://localhost:3100
Crawling internal links from the homepage

Crawled 2136 pages; 1975 of 1975 sitemap URLs have internal links in (0 orphans, 0 links to redirects, 0 broken links)
1975 URLs checked, 0 problems
```

Before this PR, the same check against a build of `main` found 861 orphans: 776 attraction pages (`/near/*`), 81 neighborhood pages, and `/become-featured`, `/customer-reviews`, `/marketing-tips` and `/review-guidelines`. They're linked now from:

- `/neighborhoods` and `/near`: new A-Z indexes of every indexed neighborhood and attraction, grouped by city, and both in the sitemap.
- An "Around {brewery}" section on every brewery page: the nearest indexed neighborhoods and attractions within 3 miles.
- The footer, on every page: regions, amenities, brewery types, best-breweries for every city with 5+ breweries, both new indexes, and the "For breweries" pages.

The crawl reaches 161 pages that are not in the sitemap. All 161 are `noindex`: city×amenity pages under the brewery threshold, attractions with no brewery within 3 miles, and `/saved`. So there are no indexable pages missing from the sitemap.

## Internal links (prompt 12, item 1)

| Page | Links to |
| --- | --- |
| Footer (every page) | Regions, amenities, brewery types, best-breweries (Maryland and each eligible city), map, open now, cities, counties, neighborhoods, things to do |
| Brewery | City and county (headline), each amenity (chips), nearby breweries, nearby neighborhoods and attractions |
| City | Indexed neighborhoods, indexable city×amenity pages, best-breweries if eligible, county |
| County | Its cities |
| Amenity | City×amenity pages by city |
| Type | Cities with that type (top first), other types |

## Lighthouse

Mobile, default throttling (Lighthouse 12, one run each).

Production (www.marylandbrewery.com, `main`):

| Page | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | 81 | 100 | 79 | 100 | 5.2 s | 0 | 23 ms |
| `/cities/frederick/breweries` | 99 | 100 | 100 | 100 | 2.0 s | 0 | 2 ms |
| `/breweries/7-locks-brewing` | 80 | 100 | 96 | 100 | 5.1 s | 0 | 29 ms |

Local build of this branch (new pages):

| Page | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/neighborhoods` | 96 | 100 | 96 | 100 | 2.9 s | 0 | 5 ms |
| `/near` | 95 | 100 | 96 | 100 | 2.9 s | 0 | 7 ms |

Local scores for pages with a map are not comparable to production. The browser Maps key rejects `localhost` (`RefererNotAllowedMapError`), and `/_vercel/insights` 404s, so best practices drops. Google Maps' `webgl.js` also costs 2.4 s of main-thread time on the brewery page locally (TBT 1.5 s, against 29 ms in production).

Rerun on 2026-10-29 against production, three runs each (Lighthouse 12, mobile):

| Page | Performance | LCP | TBT |
| --- | --- | --- | --- |
| `/` | 97, 97, 97 | 2.6 s, 2.6 s, 2.6 s | 10–20 ms |
| `/breweries/7-locks-brewing` | 90, 97, 98 | 2.8 s, 2.1 s, 2.3 s | 40–210 ms |

The ~5 s LCP in the table above was a first run against a cold cache. Warm, the homepage is 0.1 s over the 2.5 s LCP budget. Its LCP element is the hero photo. TTFB is about 40% of LCP, and Lighthouse estimates 119 KiB of savings because a landscape photo is cropped into a 300 px-tall card on phones. A tighter crop of the hero photos in `src/config/home.ts` (then `npm run home:blur`) is the remaining lever. CLS is 0 everywhere. Lighthouse CI (`.github/workflows/lighthouse.yml`) reports these as warnings on each PR.

## Accessibility (axe)

`e2e/a11y.spec.ts` reports 0 serious or critical WCAG 2.x A/AA violations on home, map, city, county, neighborhood, brewery, `/neighborhoods`, `/near`, and the open mobile menu. Lighthouse accessibility is 100 on every page above. The full e2e suite passes (32 tests).

## Before and after (Ahrefs, 2026-01-07)

The baseline is `docs/ahrefs-2026-01-summary.md`. "After" is this QA run, from `seo:check` over the full sitemap and the homepage crawl.

| Issue | Ahrefs 2026-01 | Now |
| --- | --- | --- |
| Sitemap URLs | not recorded | 1,975 (all 200, self-canonical, indexable) |
| 404 / 4XX pages in sitemap | 579 | 0 |
| Pages linking to a broken page | 338 | 0 |
| Indexable orphan pages | 1,426 | 0 |
| Page links to a redirect | 578 | 0 |
| Non-canonical page in sitemap | 3 | 0 |
| Title too long | 1,025 | 0 (≤ 60) |
| Meta description too long | 876 | 0 (≤ 155) |
| Indexable page not in sitemap | 134 | 0 of the 161 crawled pages outside the sitemap |
| Page in multiple sitemaps (duplicate URLs) | 15 | 0 |

Ahrefs measures some of these differently (its title limit is in pixels, and it crawls external links), so the fresh crawl below is the real comparison.

## Dead code

`npx knip` (config in `knip.json`) reports nothing. Removed in this PR:

- 25 one-off scripts in `scripts/archived/` (in git history; `docs/scripts.md` says how to find them).
- Unused files: `src/lib/content-generators.ts`, `src/lib/seo-content.ts`, `src/types/{api,content,seo}.ts`, `src/components/ui/badge.tsx`.
- Unused exports and the functions behind them in `src/lib/db/attractions.ts`, `brewery-data.ts`, `hours.ts`, `layout-utils.ts`, `neighborhood-utils.ts`, `seo-utils.ts`, `Chip.tsx`, `src/types/brewery.ts`. Constants only used in their own module are no longer exported.

Kept, and why (each is listed in `knip.json`):

| Item | Why |
| --- | --- |
| `eslint-config-next` | Loaded by `eslint.config.mjs` through `FlatCompat`, which knip can't follow |
| `lightningcss` | Added directly in 94ea420 to fix a Vercel build. `@tailwindcss/node` depends on it anyway, so it can likely go; remove it in its own PR after a preview build passes |
| `mapshaper` | CLI run by `npm run map:counties` through `npx` |
| `postcss` | Peer of `@tailwindcss/postcss`, read by `postcss.config.mjs` |
| `src/lib/db/database.types.ts` | Generated (`npm run db:types`); unused exports are part of the generated file |
| `docs/**` | Design tokens and artboards are reference material, not code |
| Hostnames in `preview-links.yml` | Arguments to the link checker, not binaries |
| Types used in exported signatures | `ignoreExportsUsedInFile` for types, so callers can name a component's props |

## Post-deploy steps

After this merges and production redeploys:

1. Rerun `npm run seo:check -- https://www.marylandbrewery.com` and confirm 0 problems.
2. Google Search Console: submit `https://www.marylandbrewery.com/sitemap.xml` (Indexing > Sitemaps). Then use URL Inspection to request indexing for `/`, `/neighborhoods` and `/near`.
3. Bing Webmaster Tools: submit the same sitemap (row 15 in `docs/seo-audit-2026.md`).
4. Do not bulk-submit the sitemap to IndexNow: Bing Webmaster Tools flags it as batch mode, and the sitemap from step 3 already covers every page. `.github/workflows/indexnow.yml` submits new URLs after each production deploy (`npm run indexnow -- --all` exists but should stay rare).
5. After one week, run a fresh Ahrefs site audit and fill in the table above with its numbers.

## Rerunning

```bash
npm run build && npx next start -p 3100
npm run seo:check -- http://localhost:3100
npx playwright test e2e/a11y.spec.ts
npx -y lighthouse@12 http://localhost:3100/ --chrome-flags="--headless=new" --view
npx -y knip@5
```

Against a Vercel preview, set `VERCEL_AUTOMATION_BYPASS_SECRET` (Vercel > Settings > Deployment Protection > Protection Bypass for Automation) first: `VERCEL_AUTOMATION_BYPASS_SECRET=... npm run seo:check -- https://<preview>.vercel.app`.
