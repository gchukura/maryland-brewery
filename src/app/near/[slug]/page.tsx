import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import {
  fetchAttractionSlug,
  getAttractionBySlug,
  getAttractionPage,
  getAttractionPages,
  getIndexableAttractions,
  getPlacesByType,
  getProcessedBreweryData,
} from '@/lib/db';
import type { AttractionPageData } from '@/lib/db';
import { slugify } from '@/lib/slug';
import { cityListingPath } from '@/lib/listing-links';
import { buildMetadata } from '@/lib/seo/metadata';
import { attractionMeta, attractionPageMeta, countyLabel, placeTypeMeta } from '@/lib/seo/page-meta';
import { collectionPage } from '@/lib/seo/jsonld';
import JsonLd from '@/components/seo/JsonLd';
import ListingPage from '@/components/listing/ListingPage';
import type { RelatedGroup } from '@/components/listing/RelatedLinks';
import SectionHeading from '@/components/ui/SectionHeading';
import PlaceTypePage from '@/components/near/PlaceTypePage';
import {
  attractionIntro,
  breweryBadges,
  categoryNoun,
  isIndexableAttraction,
  listedBreweries,
  listedSummary,
  miles,
  nearbyAttractionPages,
  placeTypeBySlug,
} from '@/lib/attractions';
import { sortByDistance } from '@/lib/geo';
import type { Brewery } from '@/types/brewery';

/**
 * /near/[slug] is two kinds of page. A type slug (/near/museums, src/lib/attractions.ts
 * PLACE_TYPES) is that type's page; type slugs are reserved, so no attraction uses one.
 * Anything else is breweries near an attraction. Attraction pages (has_pseo_page and enough reviews,
 * src/lib/attractions.ts) get the full template: an intro from our own data, the breweries from
 * attraction_breweries, a pin for the attraction and other attraction pages nearby. Every other
 * attraction keeps the basic list. Google's description, photos and rating text are never shown.
 */

const NEARBY_MILES = 10;
const pagePath = (slug: string) => `/near/${slug}`;

// Prerender the type pages and the indexed attraction pages (the same lists as the sitemap);
// other attractions render on demand
export async function generateStaticParams() {
  const [types, attractions] = await Promise.all([getPlacesByType(), getIndexableAttractions()]);
  return [...types.map((g) => ({ slug: g.type.slug })), ...attractions.map((a) => ({ slug: a.slug }))];
}

type Params = { params: Promise<{ slug: string }> };

/** The type page for a slug: null when the slug isn't a type, 'empty' for a type with no places. */
async function loadTypePage(slug: string) {
  const type = placeTypeBySlug(slug);
  if (!type) return null;
  const groups = await getPlacesByType();
  const group = groups.find((g) => g.type === type);
  if (!group) return 'empty' as const;
  return { type, places: group.places, types: groups.map((g) => ({ type: g.type, count: g.places.length })) };
}

const mostVisitedNames = (places: { name: string; ratingCount: number | null }[]) =>
  [...places].sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0)).slice(0, 2).map((p) => p.name);

/** An attraction page's breweries joined to the directory, with what the page shows about them. */
async function loadAttractionPage(page: AttractionPageData) {
  const { breweries } = await getProcessedBreweryData();
  const byId = new Map(breweries.map((b) => [b.id, b]));
  const rows = page.breweries.flatMap((r) => {
    const brewery = byId.get(r.breweryId);
    return brewery ? [{ ...brewery, distanceMiles: r.distanceMiles }] : [];
  });
  const selection = listedBreweries(rows);
  return { rows, selection };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;

  const typePage = await loadTypePage(slug);
  if (typePage === 'empty') return { title: 'Not Found', robots: { index: false, follow: false } };
  if (typePage) {
    return buildMetadata({
      ...placeTypeMeta(typePage.type.title, typePage.places.length, mostVisitedNames(typePage.places)),
      path: pagePath(typePage.type.slug),
    });
  }

  const page = await getAttractionPage(slug);
  if (page) {
    const { selection } = await loadAttractionPage(page);
    const meta = attractionPageMeta(page.name, page.city, selection.listed.length, selection.radiusMiles, selection.mode);
    return buildMetadata({ ...meta, path: pagePath(page.slug) });
  }

  const attraction = await getAttractionBySlug(slug);
  if (!attraction || attraction.isHidden) {
    return {
      title: 'Attraction Not Found',
      robots: { index: false, follow: false },
    };
  }
  const processed = await getProcessedBreweryData();
  const nearby = sortByDistance(attraction, processed.breweries).filter((b) => b.distance <= NEARBY_MILES);
  return buildMetadata({
    ...attractionMeta(attraction.displayName ?? attraction.name, attraction.city, nearby.length),
    path: pagePath(attraction.slug),
    // Index real sights with a brewery within 3 miles (src/lib/attractions.ts)
    noindex: !isIndexableAttraction(attraction, nearby[0]?.distance),
  });
}

export default async function NearAttractionPage({ params }: Params) {
  const { slug } = await params;
  const typePage = await loadTypePage(slug);
  if (typePage === 'empty') notFound();
  if (typePage) return <PlaceTypePage {...typePage} />;

  const page = await getAttractionPage(slug);
  if (page) return <AttractionPage page={page} />;

  const attraction = await getAttractionBySlug(slug);
  if (!attraction) notFound();
  if (attraction.isHidden) {
    // A merged duplicate's URL goes to the place it was merged into; other hidden places are gone
    const target = attraction.duplicateOf ? await fetchAttractionSlug(attraction.duplicateOf) : null;
    if (target) permanentRedirect(pagePath(target));
    notFound();
  }
  const name = attraction.displayName ?? attraction.name;
  const processed = await getProcessedBreweryData();
  const origin = { latitude: attraction.latitude, longitude: attraction.longitude };
  const nearby = sortByDistance(origin, processed.breweries).filter((b) => b.distance <= NEARBY_MILES);
  const cityPath = cityListingPath(processed.byCity, attraction.city);
  const title = `Breweries near ${name}`;
  const nearest = nearby[0]?.distance;
  return (
    <>
      <JsonLd data={collectionPage({ name: title, path: pagePath(attraction.slug), breweries: nearby })} />
      <ListingPage
        scope="neighborhood"
        title={title}
        breadcrumbs={[
          { name: 'Home', path: '/' },
          ...(cityPath ? [{ name: `${attraction.city}, MD`, path: cityPath }] : []),
          { name, path: pagePath(attraction.slug) },
        ]}
        breweries={nearby}
        summary={
          nearest === undefined
            ? `No breweries within ${NEARBY_MILES} miles.`
            : `${nearby.length} ${nearby.length === 1 ? 'brewery' : 'breweries'} within ${NEARBY_MILES} miles. The nearest is ${nearest.toFixed(1)} miles away.`
        }
        origin={origin}
        related={moreLinks(attraction.city, attraction.county ?? null, cityPath)}
      />
    </>
  );
}

function moreLinks(city: string | null, county: string | null, cityPath: string | null): RelatedGroup[] {
  return [
    {
      title: 'More nearby',
      links: [
        ...(cityPath && city ? [{ label: `${city} breweries`, href: cityPath }] : []),
        ...(county ? [{ label: `${countyLabel(county)} breweries`, href: `/counties/${slugify(county)}/breweries` }] : []),
        { label: 'Brewery map', href: '/map' },
      ],
    },
  ];
}

async function AttractionPage({ page }: { page: AttractionPageData }) {
  const [{ rows, selection }, processed, pages] = await Promise.all([
    loadAttractionPage(page),
    getProcessedBreweryData(),
    getAttractionPages(),
  ]);
  const { listed, radiusMiles, mode } = selection;
  const path = pagePath(page.slug);
  const title = `Breweries near ${page.name}`;
  const cityPath = page.city ? cityListingPath(processed.byCity, page.city) : null;
  const intro = attractionIntro({
    name: page.name,
    category: page.category,
    city: page.city,
    within5: rows.filter((r) => r.distanceMiles <= 5).length,
    within10: rows.length,
    listed: listed.length,
    radiusMiles,
    mode,
    nearest: listed[0] ? { name: listed[0].name, distanceMiles: listed[0].distanceMiles } : null,
  });
  const breweries: (Brewery & { distance: number; badges: string[] })[] = listed.map((b) => ({
    ...b,
    distance: b.distanceMiles,
    badges: breweryBadges(b),
  }));
  const nearbyPages = nearbyAttractionPages(page, pages);

  return (
    <>
      <JsonLd data={collectionPage({ name: title, description: intro, path, breweries })} />
      <ListingPage
        scope="attraction"
        title={title}
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: 'Things to do', path: '/near' },
          ...(cityPath && page.city ? [{ name: `${page.city}, MD`, path: cityPath }] : []),
          { name: page.name, path },
        ]}
        breweries={breweries}
        summary={listedSummary(listed.length, radiusMiles, listed[0]?.distanceMiles)}
        intro={<p className="m-0">{intro}</p>}
        origin={{ latitude: page.latitude, longitude: page.longitude }}
        landmark={{ name: page.name, latitude: page.latitude, longitude: page.longitude }}
        showTodayHours
        related={moreLinks(page.city, page.county, cityPath)}
      >
        {nearbyPages.length > 0 && (
          <section aria-labelledby="more-to-do" className="flex flex-col gap-4">
            <SectionHeading id="more-to-do" title="More to do nearby" size="md" />
            <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {nearbyPages.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={pagePath(p.slug)}
                    className="group flex h-full flex-col gap-1 rounded-card border border-line bg-white p-4 text-ink hover:border-ink hover:text-ink"
                  >
                    <span className="font-display text-lg font-semibold leading-tight group-hover:text-brand-red">
                      {p.name}
                    </span>
                    <span className="text-sm text-muted">
                      {categoryNoun(p.category).replace(/^./, (c) => c.toUpperCase())} · {miles(p.distanceMiles)} away
                    </span>
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
