import type { Metadata } from 'next';
import { getProcessedBreweryData } from '@/lib/db';
import { buildMetadata } from '@/lib/seo/metadata';
import { collectionPage } from '@/lib/seo/jsonld';
import { AZ_LETTERS, azGroups } from '@/lib/attractions';
import JsonLd from '@/components/seo/JsonLd';
import PageHeader from '@/components/ui/PageHeader';
import AZList from '@/components/listing/AZList';

export const revalidate = 3600;

/**
 * Every brewery A to Z. The footer links here from every page, so any brewery is two clicks from
 * anywhere (listings only put their first 12 breweries in the HTML).
 */
async function listedBreweries() {
  const { breweries } = await getProcessedBreweryData();
  // The same breweries as the sitemap: a page needs a name, city and slug
  return breweries.filter((b) => b.name && b.city && b.slug);
}

export async function generateMetadata(): Promise<Metadata> {
  const count = (await listedBreweries()).length;
  return buildMetadata({
    title: 'All Maryland Breweries A to Z',
    description: `All ${count} Maryland breweries, taprooms, cideries and meaderies from A to Z, each with hours, a map, amenities and the breweries nearby.`,
    path: '/breweries',
  });
}

export default async function AllBreweriesPage() {
  const breweries = await listedBreweries();
  const groups = azGroups(breweries.map((b) => ({ name: b.name, slug: b.slug, city: b.city })));
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 pb-16 pt-6 sm:px-6">
      <JsonLd
        data={collectionPage({
          name: 'All Maryland breweries',
          path: '/breweries',
          breweries: groups.flatMap((g) => g.items),
        })}
      />
      <PageHeader
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: 'All breweries', path: '/breweries' },
        ]}
        title="All breweries, A to Z"
        intro={`Every one of Maryland's ${breweries.length} breweries, taprooms, cideries and meaderies in the directory.`}
      />
      <AZList groups={groups} letters={AZ_LETTERS} noun="breweries" basePath="/breweries/" />
    </div>
  );
}
