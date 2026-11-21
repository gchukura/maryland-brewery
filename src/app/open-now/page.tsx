import { Metadata } from 'next';
import { getProcessedBreweryData } from '@/lib/db';
import { buildMetadata } from '@/lib/seo/metadata';
import { collectionPage } from '@/lib/seo/jsonld';
import JsonLd from '@/components/seo/JsonLd';
import ListingPage, { byRating } from '@/components/listing/ListingPage';
import { DAYS, isOpenAt } from '@/lib/hours';

export const revalidate = 3600; // ISR hourly; the list itself updates in the browser

export const metadata: Metadata = buildMetadata({
  title: 'Breweries Open Now in Maryland',
  description:
    "Maryland breweries open right now, by Maryland time, with today's closing times, a map and ratings. Filter by amenity or type to pick where to go next.",
  path: '/open-now',
});

export default async function OpenNowPage() {
  const processed = await getProcessedBreweryData();
  const openAtRender = byRating(
    processed.breweries.filter((b) => isOpenAt(b.hours).open)
  );

  return (
    <>
      <JsonLd
        data={collectionPage({
          name: 'Breweries Open Now in Maryland',
          path: '/open-now',
          breweries: openAtRender,
        })}
      />
      <ListingPage
        scope="open-now"
        title="Breweries open now"
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: 'Open Now', path: '/open-now' },
        ]}
        // Every brewery: the open filter is fixed on and recomputed in the browser, minute by minute
        breweries={processed.breweries}
        summary="Open right now across Maryland, by Maryland time. The list updates while you watch."
        related={[
          {
            title: 'Open on a given day',
            links: DAYS.map((day) => ({
              label: day[0].toUpperCase() + day.slice(1),
              href: `/open/${day}`,
            })),
          },
          {
            title: 'Browse',
            links: [
              { label: 'Brewery map', href: '/map' },
              { label: 'All cities', href: '/cities' },
              { label: 'Amenities', href: '/amenities' },
            ],
          },
        ]}
      />
    </>
  );
}
