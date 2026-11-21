import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getAllNeighborhoods,
  getAttractionsNearBrewery,
  getIndexableAttractions,
  getNeighborhoodBySlug,
  getProcessedBreweryData,
} from '@/lib/db';
import type { Tables } from '@/lib/db';
import { cityListingPath } from '@/lib/listing-links';
import { milesToKm, sortByDistance } from '@/lib/geo';
import {
  NEIGHBORHOOD_INDEX_RADIUS_MILES,
  breweriesNearNeighborhood,
  isIndexableNeighborhood,
  neighborhoodPath,
  neighborhoodPlace,
} from '@/lib/neighborhoods';
import { buildMetadata } from '@/lib/seo/metadata';
import { neighborhoodMeta } from '@/lib/seo/page-meta';
import { collectionPage } from '@/lib/seo/jsonld';
import JsonLd from '@/components/seo/JsonLd';
import ListingPage from '@/components/listing/ListingPage';
import SectionHeading from '@/components/ui/SectionHeading';
import { placeType } from '@/lib/attractions';

const ATTRACTION_LIMIT = 6;
// Fetch extra so filtering out shops and offices still leaves enough to show
const ATTRACTION_CANDIDATES = 60;

type NeighborhoodWithCoords = Tables<'maryland_neighborhoods'> & {
  latitude: number;
  longitude: number;
};

function hasCoords(
  n: Tables<'maryland_neighborhoods'>
): n is NeighborhoodWithCoords {
  return typeof n.latitude === 'number' && typeof n.longitude === 'number';
}

async function loadNeighborhood(slug: string) {
  const neighborhood = await getNeighborhoodBySlug(slug);
  if (!neighborhood || !hasCoords(neighborhood) || !neighborhood.city)
    return null;

  const processed = await getProcessedBreweryData();
  const breweries = breweriesNearNeighborhood(
    neighborhood,
    processed.breweries
  );
  const nearestMiles = breweries[0]?.distance;
  const cityPath = cityListingPath(processed.byCity, neighborhood.city);
  return { neighborhood, city: neighborhood.city, cityPath, breweries, nearestMiles };
}

// Prerender the neighborhoods that are indexed; the rest render on first request.
export async function generateStaticParams() {
  const [neighborhoods, processed] = await Promise.all([
    getAllNeighborhoods(),
    getProcessedBreweryData(),
  ]);
  return neighborhoods
    .filter(hasCoords)
    .filter((n) =>
      isIndexableNeighborhood(
        sortByDistance(n, processed.breweries)[0]?.distance
      )
    )
    .map((n) => ({ slug: n.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadNeighborhood(slug);
  if (!data)
    return {
      title: 'Neighborhood Not Found',
      robots: { index: false, follow: false },
    };

  const { neighborhood, city, breweries, nearestMiles } = data;
  return buildMetadata({
    ...neighborhoodMeta(neighborhood.name, city, breweries.length),
    path: neighborhoodPath(neighborhood.slug),
    // Thin pages: only index neighborhoods with a brewery within 3 miles
    noindex: !isIndexableNeighborhood(nearestMiles),
  });
}

export default async function NeighborhoodPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await loadNeighborhood(slug);
  if (!data) notFound();

  const { neighborhood, city, cityPath, breweries, nearestMiles } = data;
  const withinIndexRadius = breweries.filter(
    (b) => b.distance <= NEIGHBORHOOD_INDEX_RADIUS_MILES
  ).length;
  const [nearbyAttractions, listedAttractions] = await Promise.all([
    getAttractionsNearBrewery(
      neighborhood.latitude,
      neighborhood.longitude,
      milesToKm(NEIGHBORHOOD_INDEX_RADIUS_MILES),
      ATTRACTION_CANDIDATES
    ),
    getIndexableAttractions(),
  ]);
  // Only places listed on /near (indexed, not hidden), under their display names
  const listed = new Map(listedAttractions.map((a) => [a.slug, a]));
  const attractions = sortByDistance(
    neighborhood,
    nearbyAttractions.flatMap((a) => {
      const summary = listed.get(a.slug);
      return summary ? [{ ...a, name: summary.name, kind: placeType(summary.category).noun }] : [];
    })
  ).slice(0, ATTRACTION_LIMIT);

  const pagePath = neighborhoodPath(neighborhood.slug);
  const summary =
    nearestMiles === undefined
      ? 'No breweries found nearby.'
      : withinIndexRadius > 0
        ? `${withinIndexRadius} ${withinIndexRadius === 1 ? 'brewery' : 'breweries'} within ${NEIGHBORHOOD_INDEX_RADIUS_MILES} miles. The nearest is ${nearestMiles.toFixed(1)} miles away.`
        : `The nearest brewery is ${nearestMiles.toFixed(1)} miles away.`;

  return (
    <>
      <JsonLd
        data={collectionPage({
          name: `Breweries near ${neighborhoodPlace(neighborhood.name, city)}`,
          path: pagePath,
          breweries,
        })}
      />
      <ListingPage
        scope="neighborhood"
        title={`Breweries near ${neighborhoodPlace(neighborhood.name, city)}`}
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: 'Cities', path: '/cities' },
          ...(cityPath ? [{ name: `${city}, MD`, path: cityPath }] : []),
          { name: neighborhood.name, path: pagePath },
        ]}
        breweries={breweries}
        summary={summary}
        intro={
          neighborhood.description ? (
            <p className="m-0">{neighborhood.description}</p>
          ) : undefined
        }
        origin={{
          latitude: neighborhood.latitude,
          longitude: neighborhood.longitude,
        }}
        related={
          cityPath
            ? [
                {
                  title: `More in ${city}`,
                  links: [{ label: `All ${city} breweries`, href: cityPath }],
                },
              ]
            : undefined
        }
      >
        {attractions.length > 0 && (
          <section className="flex flex-col gap-4">
            <SectionHeading
              title={`Things to do near ${neighborhood.name}`}
              size="md"
            />
            <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {attractions.map((attraction) => (
                <li key={attraction.slug}>
                  <Link
                    href={`/near/${attraction.slug}`}
                    className="block h-full rounded-card border border-line bg-white p-4 text-ink hover:border-line-strong hover:text-ink"
                  >
                    <p className="m-0 font-semibold">{attraction.name}</p>
                    <p className="m-0 text-sm capitalize text-muted">
                      {attraction.kind} ·{' '}
                      {attraction.distance.toFixed(1)} mi
                    </p>
                    <p className="m-0 mt-2 text-sm font-semibold text-brand-red">
                      Breweries near {attraction.name} →
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </ListingPage>
    </>
  );
}
