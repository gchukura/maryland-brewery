/**
 * Snapshot of the public names that page titles are built from, for src/lib/seo/page-meta.test.ts.
 * Run after big data changes: npm run seo:fixture
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { writeFileSync } from 'fs';
import { getBreweryDataFromSupabase, getAllNeighborhoods, fetchRegions } from '@/lib/db/queries';
import { getSupabase } from '@/lib/db/client';
import { sortByDistance } from '@/lib/geo';
import { isIndexableNeighborhood } from '@/lib/neighborhoods';
import { ATTRACTION_PAGE_MIN_REVIEWS, isIndexableAttraction } from '@/lib/attractions';

async function main() {
  const breweries = await getBreweryDataFromSupabase({ detail: false });
  const neighborhoods = await getAllNeighborhoods();
  const regions = await fetchRegions();
  const attractions: { name: string; city: string; type: string; google_types: unknown; latitude: number; longitude: number; has_pseo_page: boolean; rating_count: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await getSupabase().from('maryland_attractions').select('name, city, type, google_types, latitude, longitude, has_pseo_page, rating_count').range(from, from + 999);
    if (error) throw error;
    attractions.push(...(data as typeof attractions));
    if (data.length < 1000) break;
  }
  const nearest = (p: { latitude: number; longitude: number }) => sortByDistance(p, breweries)[0]?.distance;
  const fixture = {
    breweries: breweries.map((b) => ({ name: b.name, city: b.city, type: b.type })),
    cities: [...new Set(breweries.map((b) => b.city))].sort(),
    counties: [...new Set(breweries.map((b) => b.county).filter(Boolean))].sort(),
    regions: regions.map((r) => ({ name: r.name, counties: r.counties })),
    types: [...new Set(breweries.flatMap((b) => b.type))].sort(),
    neighborhoods: neighborhoods
      .filter((n) => n.latitude != null && n.longitude != null && n.city)
      .filter((n) => isIndexableNeighborhood(nearest({ latitude: n.latitude!, longitude: n.longitude! })))
      .map((n) => ({ name: n.name, city: n.city })),
    attractions: attractions
      .filter((a) => isIndexableAttraction({ type: a.type, googleTypes: Array.isArray(a.google_types) ? (a.google_types as string[]) : [] }, nearest(a)))
      .map((a) => ({ name: a.name, city: a.city })),
    // Attraction pages (full /near template); titled with attractionPageMeta
    attractionPages: attractions
      .filter((a) => a.has_pseo_page && (a.rating_count ?? 0) >= ATTRACTION_PAGE_MIN_REVIEWS)
      .map((a) => ({ name: a.name, city: a.city })),
  };
  writeFileSync('src/lib/seo/__fixtures__/real-names.json', JSON.stringify(fixture, null, 1) + '\n');
  console.log(Object.fromEntries(Object.entries(fixture).map(([k, v]) => [k, v.length])));
}
main().catch((e) => { console.error(e); process.exit(1); });
