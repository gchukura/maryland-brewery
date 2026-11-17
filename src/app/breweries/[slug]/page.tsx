import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ExternalLink, MapPin, Phone } from 'lucide-react';
import {
  getBreweryArticles,
  getBreweryBySlug,
  getBreweryReviews,
  getIndexableAttractions,
  getIndexableNeighborhoods,
  getProcessedBreweryData,
} from '@/lib/db';
import {
  NEIGHBORHOOD_INDEX_RADIUS_MILES,
  neighborhoodPath,
} from '@/lib/neighborhoods';
import type { Brewery } from '@/types/brewery';
import { amenityForValue, amenityPath } from '@/lib/amenities';
import {
  directionsUrl,
  headlineParts,
  monthYear,
  pickExcerpts,
  themeChips,
  visitTiles,
} from '@/lib/brewery-page';
import { externalUrl } from '@/lib/format';
import { sortByDistance } from '@/lib/geo';
import {
  DAYS,
  formatDayHours,
  isOpenAt,
  zonedDayAndMinutes,
} from '@/lib/hours';
import { canOptimizeImage } from '@/lib/images';
import { toListingBrewery } from '@/lib/listing';
import { buildMetadata, pickDescription } from '@/lib/seo/metadata';
import { breweryMeta, countyLabel } from '@/lib/seo/page-meta';
import { brewerySchema } from '@/lib/seo/jsonld';
import { generateEnhancedBreweryDescription } from '@/lib/seo-utils';
import { slugify } from '@/lib/slug';
import { cn } from '@/lib/utils';
import JsonLd from '@/components/seo/JsonLd';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import BreweryCard from '@/components/ui/BreweryCard';
import { ButtonLink } from '@/components/ui/button';
import SectionHeading from '@/components/ui/SectionHeading';
import StatusBadge from '@/components/ui/StatusBadge';
import PhotoGallery from '@/components/brewery/PhotoGallery';
import RailMap from '@/components/brewery/RailMap';
import SaveButton from '@/components/brewery/SaveButton';
import RailAd from '@/components/ads/RailAd';

interface BreweryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  // No try/catch: a data error here should fail the build, not ship zero brewery pages
  const processed = await getProcessedBreweryData();
  return processed.breweries
    .filter((b) => /^[a-z0-9-]+$/.test(b.slug))
    .map((b) => ({ slug: b.slug }));
}

/**
 * The listed brewery for a URL segment (a slug, or an old id URL), or null.
 * A data error throws instead of returning null, so an outage never turns into a cached 404.
 */
async function findListed(slug: string): Promise<Brewery | null> {
  const processed = await getProcessedBreweryData();
  return (
    processed.breweries.find((b) => b.slug === slug || b.id === slug) ?? null
  );
}

export async function generateMetadata({ params }: BreweryPageProps) {
  const brewery = await findListed((await params).slug);
  if (!brewery)
    return {
      title: 'Brewery Not Found',
      robots: { index: false, follow: false },
    };
  const meta = breweryMeta(brewery);
  const enhanced = generateEnhancedBreweryDescription({
    name: brewery.name,
    city: brewery.city,
    county: brewery.county,
    type: brewery.type,
    description: brewery.description,
    googleRating: brewery.googleRating,
    amenities: brewery.amenities,
    offersTours: brewery.offersTours,
    dogFriendly: brewery.dogFriendly,
    food: brewery.food,
    outdoorSeating: brewery.outdoorSeating,
  });
  return buildMetadata({
    title: meta.title,
    // The per-brewery description when it fits, otherwise the standard one
    description: pickDescription([enhanced, meta.description]),
    path: `/breweries/${brewery.slug}`,
  });
}

const DAY_ORDER = [...DAYS.slice(1), DAYS[0]]; // Monday first
const SOCIAL_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  twitter: 'X (Twitter)',
  untappd: 'Untappd',
};
const NEARBY_MILES = 25;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w) && !/^(the|of|and|&)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function Section({
  title,
  children,
  className,
  id,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  id: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn('flex flex-col gap-4 lg:col-start-1', className)}
    >
      <SectionHeading id={id} title={title} size="md" />
      {children}
    </section>
  );
}

export default async function BreweryPage({ params }: BreweryPageProps) {
  const { slug } = await params;
  const listed = await findListed(slug);
  if (!listed) notFound();
  // /breweries/{id} is a duplicate of the slug URL
  if (slug !== listed.slug) permanentRedirect(`/breweries/${listed.slug}`);

  // The cached list leaves out review themes and beers; load this brewery's full record
  const brewery = await getBreweryBySlug(listed.slug);
  if (!brewery?.name || !brewery.city) notFound();

  const [
    processed,
    reviewData,
    articles,
    indexableNeighborhoods,
    indexableAttractions,
  ] = await Promise.all([
    getProcessedBreweryData(),
    getBreweryReviews(brewery.id, 20, 0),
    getBreweryArticles(brewery.id, 5),
    getIndexableNeighborhoods(),
    getIndexableAttractions(),
  ]);

  const now = new Date();
  const { day: today } = zonedDayAndMinutes(now);
  const tiles = visitTiles(brewery, now);
  const themes = themeChips(brewery.reviewThemes);
  const excerpts = pickExcerpts(reviewData.reviews);
  const beers = (brewery.beers ?? []).filter((b) => b.name);
  const amenities = (brewery.amenities ?? [])
    .map((value) => ({ value, def: amenityForValue(value) }))
    .filter(
      (a, i, all) =>
        all.findIndex(
          (x) => (x.def?.slug ?? x.value) === (a.def?.slug ?? a.value)
        ) === i
    );
  const photos = [...new Set(brewery.photos ?? [])];
  const hasHours = DAYS.some((d) => brewery.hours?.[d]);
  const website = externalUrl(brewery.website);
  const socials = Object.entries(brewery.socialMedia ?? {})
    .map(([network, url]) => ({
      label: SOCIAL_LABELS[network] ?? network,
      href: externalUrl(url),
    }))
    .filter((s): s is { label: string; href: string } => !!s.href);

  // Nearest others within 25 miles (at least three when there are any)
  const byDistance = sortByDistance(brewery, processed.breweries).filter(
    (b) => b.slug !== brewery.slug
  );
  const withinRange = byDistance.filter((b) => b.distance <= NEARBY_MILES);
  const nearby = (withinRange.length >= 3 ? withinRange : byDistance).slice(
    0,
    6
  );

  // The nearest indexed neighborhood and attraction pages within 3 miles. /neighborhoods and /near
  // link every one of them; these are the ones worth a visit from here
  const AROUND = 6;
  const aroundNeighborhoods = sortByDistance(brewery, indexableNeighborhoods)
    .filter((n) => n.distance <= NEIGHBORHOOD_INDEX_RADIUS_MILES)
    .slice(0, AROUND);
  const aroundAttractions = sortByDistance(brewery, indexableAttractions)
    .filter((a) => a.distance <= NEIGHBORHOOD_INDEX_RADIUS_MILES)
    .slice(0, AROUND);
  const headline = headlineParts(brewery);

  const citySlug = slugify(brewery.city);
  const pagePath = `/breweries/${brewery.slug}`;
  const address = [
    brewery.street,
    `${brewery.city}, MD ${brewery.zip ?? ''}`.trim(),
  ]
    .filter(Boolean)
    .join(', ');
  // Only a real check counts: updated_at moves on every bulk data fix
  const hoursChecked = monthYear(brewery.hoursVerifiedAt);

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-7 px-4 pb-16 pt-6 sm:px-6">
      <JsonLd data={brewerySchema(brewery)} />
      <Breadcrumbs
        items={[
          { name: 'Home', path: '/' },
          { name: brewery.city, path: `/cities/${citySlug}/breweries` },
          { name: brewery.name, path: pagePath },
        ]}
      />

      <PhotoGallery photos={photos} name={brewery.name} />

      {/* Title band */}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4 sm:gap-[18px]">
          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-panel border border-line bg-white font-display text-xl font-bold text-ink sm:h-[84px] sm:w-[84px] sm:text-[26px]">
            {brewery.logo && canOptimizeImage(brewery.logo) ? (
              <Image
                src={brewery.logo}
                alt={`${brewery.name} logo`}
                fill
                sizes="84px"
                className="object-contain p-2"
              />
            ) : (
              <span aria-hidden="true">{initials(brewery.name)}</span>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h1 className="m-0 font-display text-[32px] font-bold leading-[1.05] tracking-[-0.01em] text-ink md:text-[44px]">
                {brewery.name}
              </h1>
              <StatusBadge hours={brewery.hours} size="md" />
            </div>
            <p className="m-0 text-base text-muted">
              {[
                headline.type,
                <span key="place">
                  <Link
                    href={`/cities/${citySlug}/breweries`}
                    className="text-muted underline decoration-line-strong underline-offset-2 hover:text-brand-red"
                  >
                    {brewery.city}
                  </Link>
                  {brewery.county && (
                    <>
                      ,{' '}
                      <Link
                        href={`/counties/${slugify(brewery.county)}/breweries`}
                        className="text-muted underline decoration-line-strong underline-offset-2 hover:text-brand-red"
                      >
                        {countyLabel(brewery.county)}
                      </Link>
                    </>
                  )}
                </span>,
                headline.opened,
              ]
                .filter(Boolean)
                .map((part, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    {part}
                  </span>
                ))}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <ButtonLink href={directionsUrl(brewery)} external>
            <MapPin className="h-4 w-4" aria-hidden="true" />
            Get directions
          </ButtonLink>
          {website && (
            <ButtonLink href={website} external variant="secondary">
              Website
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </ButtonLink>
          )}
          <SaveButton slug={brewery.slug} name={brewery.name} />
        </div>
      </div>

      {/* Content 8/12 + rail 4/12; on phones one column with the rail after Visit (DOM order) */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:gap-x-10">
        {tiles.length > 0 && (
          <section
            aria-label="Visit"
            className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(160px,1fr))] lg:col-start-1"
          >
            {tiles.map((tile) => (
              <div
                key={tile.label}
                className="flex flex-col gap-1.5 rounded-card bg-cream p-4"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  {tile.label}
                </div>
                <div className="text-lg font-semibold leading-tight text-ink">
                  {tile.value}
                </div>
                {tile.note && (
                  <div className="text-[13px] text-muted">{tile.note}</div>
                )}
              </div>
            ))}
          </section>
        )}

        {/* Rail */}
        <aside
          aria-label="Location and hours"
          className="flex flex-col gap-6 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:row-end-7 lg:self-start"
        >
          <RailMap
            point={{
              brewery: toListingBrewery(brewery),
              open: isOpenAt(brewery.hours, now).open,
            }}
          />
          <div className="flex flex-col gap-2.5 text-[15px]">
            <a
              href={directionsUrl(brewery)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-2.5 text-ink hover:text-brand-red"
            >
              <MapPin
                className="mt-0.5 h-4 w-4 shrink-0 text-muted"
                aria-hidden="true"
              />
              <span>{address}</span>
            </a>
            {brewery.phone && (
              <a
                href={`tel:${brewery.phone.replace(/[^\d+]/g, '')}`}
                className="flex items-center gap-2.5 text-ink hover:text-brand-red"
              >
                <Phone
                  className="h-4 w-4 shrink-0 text-muted"
                  aria-hidden="true"
                />
                {brewery.phone}
              </a>
            )}
          </div>
          {hasHours && (
            <div className="flex flex-col gap-2">
              <h2 className="m-0 font-display text-xl font-semibold text-ink">
                Hours
              </h2>
              <table className="table w-full border-collapse text-[15px]">
                <tbody>
                  {DAY_ORDER.map((day) => (
                    <tr
                      key={day}
                      className={cn(
                        'border-b border-line last:border-0',
                        day === today && 'font-semibold'
                      )}
                      aria-current={day === today ? 'date' : undefined}
                    >
                      <th
                        scope="row"
                        className={cn(
                          'py-1.5 pr-4 text-left capitalize',
                          day === today ? 'font-semibold' : 'font-normal'
                        )}
                      >
                        {day}
                      </th>
                      <td className="py-1.5 text-right">
                        {brewery.hours?.[day]
                          ? formatDayHours(brewery.hours[day])
                          : 'Closed'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="m-0 text-[13px] text-muted">
                {hoursChecked && (
                  <>Hours checked against Google {hoursChecked} · </>
                )}
                <Link
                  href={`/contact?brewery=${brewery.slug}`}
                  className="font-semibold text-brand-red hover:text-brand-red-dark"
                >
                  Report a change
                </Link>
              </p>
            </div>
          )}
          {!hasHours && (
            <p className="m-0 text-[13px] text-muted">
              <Link
                href={`/contact?brewery=${brewery.slug}`}
                className="font-semibold text-brand-red hover:text-brand-red-dark"
              >
                Report a change
              </Link>
            </p>
          )}
          {socials.length > 0 && (
            <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-[15px]">
              {socials.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-brand-red hover:text-brand-red-dark"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <RailAd />
        </aside>

        {(brewery.description || amenities.length > 0) && (
          <Section id="about" title={`About ${brewery.name}`}>
            {brewery.description && (
              <p className="m-0 max-w-[68ch] text-[17px] leading-[1.6] text-ink">
                {brewery.description}
              </p>
            )}
            {amenities.length > 0 && (
              <ul
                className="m-0 flex list-none flex-wrap gap-2 p-0"
                aria-label="Amenities"
              >
                {amenities.map(({ value, def }) => (
                  <li key={value}>
                    {def ? (
                      <Link
                        href={amenityPath(def)}
                        className="inline-flex rounded-chip bg-cream px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-line"
                      >
                        {def.label}
                      </Link>
                    ) : (
                      <span className="inline-flex rounded-chip bg-cream px-3 py-1.5 text-[13px] font-semibold text-ink">
                        {value}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {beers.length > 0 && (
          <Section id="on-tap" title="On tap">
            <div className="overflow-x-auto rounded-card border border-line bg-white">
              <table className="table w-full min-w-[520px] border-collapse text-left text-[15px]">
                <thead className="bg-cream text-[12px] uppercase tracking-[0.08em] text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Beer
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Style
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-semibold"
                    >
                      ABV
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Availability
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {beers.map((beer) => (
                    <tr key={beer.name} className="border-t border-line">
                      <th scope="row" className="px-4 py-2.5 font-semibold">
                        {beer.name}
                      </th>
                      <td className="px-4 py-2.5 text-muted">{beer.style}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {beer.abv
                          ? `${String(beer.abv).replace(/%$/, '')}%`
                          : ''}
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {beer.availability}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {(themes.length > 0 || excerpts.length > 0) && (
          <Section id="mentions" title="What people mention">
            {themes.length > 0 && (
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {themes.map((t) => (
                  <li
                    key={t.label}
                    className="inline-flex items-baseline gap-2 rounded-chip border-[1.5px] border-line-strong bg-white px-3.5 py-2 text-[13px]"
                    title={t.phrases.join(', ')}
                  >
                    <span className="font-semibold text-ink">{t.label}</span>
                    <span className="text-muted">{t.count} mentions</span>
                  </li>
                ))}
              </ul>
            )}
            {excerpts.length > 0 && (
              <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
                {excerpts.map((e) => (
                  <li
                    key={e.text}
                    className="flex flex-col gap-2 rounded-card border border-line bg-white p-4"
                  >
                    <blockquote className="m-0 text-[15px] leading-[1.55] text-ink">
                      “{e.text}”
                    </blockquote>
                    <p className="m-0 text-[13px] text-muted">
                      {e.reviewer} on {e.source}
                      {e.month && <> · {e.month}</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {articles.length > 0 && (
          <Section id="news" title="In the news">
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {articles.map((a) => (
                <li key={a.id}>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex flex-col gap-1 rounded-card border border-line bg-white p-4 text-ink hover:border-line-strong hover:text-ink"
                  >
                    <span className="font-semibold leading-snug group-hover:text-brand-red">
                      {a.title}
                    </span>
                    <span className="text-[13px] text-muted">
                      {[a.source, monthYear(a.published_at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {nearby.length > 0 && (
          <Section id="nearby" title="Nearby breweries">
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3">
              {nearby.map((b) => (
                <BreweryCard key={b.slug} brewery={b} />
              ))}
            </div>
            <Link
              href={`/cities/${citySlug}/breweries`}
              className="self-start text-[15px] font-semibold text-brand-red hover:text-brand-red-dark"
            >
              All {brewery.city} breweries →
            </Link>
          </Section>
        )}

        {(aroundNeighborhoods.length > 0 || aroundAttractions.length > 0) && (
          <Section id="around" title={`Around ${brewery.name}`}>
            <div className="grid gap-6 sm:grid-cols-2">
              {[
                {
                  title: 'Neighborhoods nearby',
                  items: aroundNeighborhoods.map((n) => ({
                    label: n.name,
                    href: neighborhoodPath(n.slug),
                    distance: n.distance,
                  })),
                  more: { label: 'All neighborhoods', href: '/neighborhoods' },
                },
                {
                  title: 'Things to do nearby',
                  items: aroundAttractions.map((a) => ({
                    label: a.name,
                    href: `/near/${a.slug}`,
                    distance: a.distance,
                  })),
                  more: { label: 'All things to do', href: '/near' },
                },
              ]
                .filter((g) => g.items.length > 0)
                .map((g) => (
                  <div key={g.title} className="flex flex-col gap-2">
                    <h3 className="m-0 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {g.title}
                    </h3>
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[15px]">
                      {g.items.map((item) => (
                        <li
                          key={item.href}
                          className="flex justify-between gap-3"
                        >
                          <Link
                            href={item.href}
                            className="text-ink hover:text-brand-red"
                          >
                            {item.label}
                          </Link>
                          <span className="shrink-0 text-muted">
                            {item.distance.toFixed(1)} mi
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={g.more.href}
                      className="text-[13px] font-semibold text-brand-red hover:text-brand-red-dark"
                    >
                      {g.more.label} →
                    </Link>
                  </div>
                ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
