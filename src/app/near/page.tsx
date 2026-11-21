import type { Metadata } from 'next';
import { getPlacesByType, getRegions } from '@/lib/db';
import type { AttractionSummary } from '@/lib/db';
import { buildMetadata } from '@/lib/seo/metadata';
import PageHeader from '@/components/ui/PageHeader';
import SectionHeading from '@/components/ui/SectionHeading';
import RelatedLinks from '@/components/listing/RelatedLinks';
import PlaceSearch from '@/components/near/PlaceSearch';
import TypeCard, { TYPE_CARD_TOP } from '@/components/near/TypeCard';
import HashRedirect from '@/components/near/HashRedirect';

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const total = (await getPlacesByType()).reduce((n, g) => n + g.places.length, 0);
  return buildMetadata({
    title: 'Things to Do Near Maryland Breweries',
    description: `${total.toLocaleString('en-US')} parks, museums, galleries, theaters and more near Maryland breweries, by type, each with the closest breweries and a map.`,
    path: '/near',
  });
}

/** Most visited first by Google review count; places without one aren't ranked. */
function mostVisited(places: AttractionSummary[]) {
  return places
    .filter((p) => (p.ratingCount ?? 0) > 0)
    .sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0) || a.name.localeCompare(b.name))
    .slice(0, TYPE_CARD_TOP)
    .map((p) => ({ name: p.name, slug: p.slug, city: p.city }));
}

export default async function ThingsToDoHub() {
  const [groups, regions] = await Promise.all([getPlacesByType(), getRegions()]);
  const total = groups.reduce((n, g) => n + g.places.length, 0);
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-10 px-4 pb-16 pt-6 sm:px-6">
      <HashRedirect map={Object.fromEntries(groups.map((g) => [g.type.slug, `/near/${g.type.slug}`]))} />
      <div className="flex flex-col gap-5">
        <PageHeader
          breadcrumbs={[
            { name: 'Home', path: '/' },
            { name: 'Things to do', path: '/near' },
          ]}
          title="Things to do near breweries"
          intro={`${total.toLocaleString('en-US')} parks, museums, galleries, theaters and other places to visit near Maryland breweries, sorted by type.`}
        />
        <PlaceSearch />
      </div>

      <section aria-labelledby="by-type" className="flex flex-col gap-5">
        <SectionHeading id="by-type" title="Browse by type" size="md" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map(({ type, places }) => (
            <TypeCard key={type.slug} type={type} count={places.length} top={mostVisited(places)} />
          ))}
        </div>
      </section>

      <RelatedLinks
        groups={[
          {
            title: 'Start from a region instead',
            links: [
              ...regions.map((r) => ({ label: r.name, href: `/region/${r.slug}` })),
              { label: 'Brewery map', href: '/map' },
            ],
          },
        ]}
      />
    </div>
  );
}
