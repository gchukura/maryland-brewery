import Link from 'next/link';
import type { AttractionSummary } from '@/lib/db';
import { AZ_LETTERS, azGroups, type PlaceType } from '@/lib/attractions';
import { cn } from '@/lib/utils';
import { SITE_URL } from '@/lib/seo/metadata';
import PageHeader from '@/components/ui/PageHeader';
import SectionHeading from '@/components/ui/SectionHeading';
import JsonLd from '@/components/seo/JsonLd';
import AZList from './AZList';

/** Ranked cards shown before the A-to-Z list. */
const MOST_VISITED = 12;
/** Types bigger than this collapse each letter after COLLAPSE_AFTER rows. */
const COLLAPSE_OVER = 150;
const COLLAPSE_AFTER = 12;

interface PlaceTypePageProps {
  type: PlaceType;
  places: AttractionSummary[];
  /** Every type with places, for the switcher */
  types: { type: PlaceType; count: number }[];
}

/** /near/[type]: one place type, its most visited places and all of them A to Z. */
export default function PlaceTypePage({ type, places, types }: PlaceTypePageProps) {
  const path = `/near/${type.slug}`;
  const lower = type.title.toLowerCase();
  const count = places.length;
  const ranked = places
    .filter((p) => (p.ratingCount ?? 0) > 0)
    .sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0) || a.name.localeCompare(b.name))
    .slice(0, MOST_VISITED);
  const groups = azGroups(places.map((p) => ({ name: p.name, slug: p.slug, city: p.city })));

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-10 px-4 pb-16 pt-6 sm:px-6">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: `${type.title} near breweries`,
          url: `${SITE_URL}${path}`,
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: count,
            itemListElement: ranked.map((p, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: p.name,
              url: `${SITE_URL}/near/${p.slug}`,
            })),
          },
        }}
      />
      <div className="flex flex-col gap-5">
        <PageHeader
          breadcrumbs={[
            { name: 'Home', path: '/' },
            { name: 'Things to do', path: '/near' },
            { name: type.title, path },
          ]}
          title={`${type.title} near breweries`}
          intro={`${count} ${count === 1 ? type.noun : lower} near Maryland breweries, each with the closest breweries and a map.`}
        />
        <nav aria-label="Types of places">
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {types.map(({ type: t, count: n }) => {
              const current = t.slug === type.slug;
              return (
                <li key={t.slug}>
                  <Link
                    href={`/near/${t.slug}`}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-chip border-[1.5px] px-3.5 text-[13px] font-semibold',
                      current
                        ? 'border-ink bg-ink text-paper hover:text-paper'
                        : 'border-line-strong bg-white text-ink hover:border-ink hover:text-ink'
                    )}
                  >
                    {t.title}
                    <span className={current ? 'font-medium text-paper/70' : 'font-medium text-muted'}>{n}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {ranked.length > 0 && (
        <section aria-labelledby="most-visited" className="flex flex-col gap-4">
          <SectionHeading id="most-visited" title="Most visited" size="md" />
          <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {ranked.map((p, i) => (
              <li key={p.slug}>
                <Link
                  href={`/near/${p.slug}`}
                  className="group flex h-full gap-3 rounded-card border border-line bg-white p-4 text-ink hover:border-ink hover:text-ink"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cream text-sm font-semibold tabular-nums text-ink"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-display text-lg font-semibold leading-tight group-hover:text-brand-red">{p.name}</span>
                    {p.city && <span className="text-sm text-muted">{p.city}</span>}
                    {p.nearbyBreweries > 0 && (
                      <span className="text-sm text-muted">
                        {p.nearbyBreweries} {p.nearbyBreweries === 1 ? 'brewery' : 'breweries'} nearby
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="a-to-z" className="flex flex-col gap-4">
        <SectionHeading id="a-to-z" title={`All ${lower}, A to Z`} size="md" />
        <AZList
          groups={groups}
          letters={AZ_LETTERS}
          noun={lower}
          collapseAfter={count > COLLAPSE_OVER ? COLLAPSE_AFTER : undefined}
        />
      </section>
    </div>
  );
}
