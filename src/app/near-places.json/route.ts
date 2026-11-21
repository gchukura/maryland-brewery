import { getIndexableAttractions } from '@/lib/db';
import { placeType } from '@/lib/attractions';

// Every place listed on /near, for the place search there (fetched on first focus)
export const dynamic = 'force-static';
export const revalidate = 3600;

export async function GET() {
  const places = await getIndexableAttractions();
  return Response.json(
    places.map((p) => ({ n: p.name, s: p.slug, t: placeType(p.category).title, c: p.city ?? '' }))
  );
}
