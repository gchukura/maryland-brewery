/**
 * Listing pages (city, county, region, amenity, type, best-of, open now, neighborhood, map): the
 * slim brewery shape sent to the browser, filter state <-> URL search params, and filtering and
 * sorting. Pure functions shared by the server template and the client island.
 */
import type { Brewery } from '@/types/brewery';
import { AMENITIES, getAmenity, hasAmenity } from '@/lib/amenities';
import { distanceMiles, type LatLng } from '@/lib/geo';
import { isOpenAt, type WeeklyHours } from '@/lib/hours';
import { slugify } from '@/lib/slug';

/** What the list, the map and the filters need; about a fifth of the full row. */
export interface ListingBrewery {
  slug: string;
  name: string;
  street: string;
  city: string;
  county: string;
  latitude: number | null;
  longitude: number | null;
  hours: WeeklyHours;
  amenities: string[];
  types: string[];
  photo: string | null;
  description: string | null;
  /** Miles from the page's origin, when the page knows them (attraction pages: PostGIS distances) */
  distance?: number;
  /** Shown instead of the amenity chips (attraction pages) */
  badges?: string[];
}

const DESCRIPTION_LENGTH = 180;

export function toListingBrewery(b: Brewery): ListingBrewery {
  const description = b.description?.trim() || null;
  return {
    slug: b.slug,
    name: b.name,
    street: b.street ?? '',
    city: b.city ?? '',
    county: b.county ?? '',
    latitude: typeof b.latitude === 'number' ? b.latitude : null,
    longitude: typeof b.longitude === 'number' ? b.longitude : null,
    hours: b.hours ?? {},
    amenities: b.amenities ?? [],
    types: b.type ?? [],
    photo: b.photos?.[0] ?? b.photoUrl ?? null,
    description:
      description && description.length > DESCRIPTION_LENGTH
        ? `${description.slice(0, DESCRIPTION_LENGTH - 1).replace(/\s+\S*$/, '')}…`
        : description,
  };
}

export const SORTS = ['open', 'distance', 'name', 'rank'] as const;
export type SortKey = (typeof SORTS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  open: 'Open now first',
  distance: 'Distance',
  name: 'Name A–Z',
  rank: 'Top rated',
};

export interface ListingFilters {
  open: boolean;
  /** Amenity slugs (lib/amenities), in the order they were chosen */
  amenities: string[];
  /** Type slug, e.g. "brewpub" */
  type: string | null;
  sort: SortKey;
  q: string;
}

export interface FilterDefaults {
  sort: SortKey;
  /** open-now pages: the open filter is always on and isn't written to the URL */
  open?: boolean;
}

type ParamSource =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

function param(source: ParamSource, key: string): string | null {
  if (!source) return null;
  if (source instanceof URLSearchParams) return source.get(key);
  const value = source[key];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/** URL -> filters. Unknown amenities, sorts and junk are ignored. */
export function parseFilters(
  source: ParamSource,
  defaults: FilterDefaults
): ListingFilters {
  const amenities = (param(source, 'amenity') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s, i, all) => s && getAmenity(s) && all.indexOf(s) === i);
  const sort = param(source, 'sort');
  const type = param(source, 'type')?.trim().toLowerCase();
  return {
    open: defaults.open || param(source, 'open') === '1',
    amenities,
    type: type ? slugify(type) : null,
    sort: (SORTS as readonly string[]).includes(sort ?? '')
      ? (sort as SortKey)
      : defaults.sort,
    q: (param(source, 'q') ?? '').trim().slice(0, 100),
  };
}

/** Filters -> query string ("" when everything is default), so the unfiltered page keeps a clean URL. */
export function serializeFilters(
  filters: ListingFilters,
  defaults: FilterDefaults
): string {
  const params = new URLSearchParams();
  if (filters.open && !defaults.open) params.set('open', '1');
  if (filters.amenities.length > 0)
    params.set('amenity', filters.amenities.join(','));
  if (filters.type) params.set('type', filters.type);
  if (filters.sort !== defaults.sort) params.set('sort', filters.sort);
  if (filters.q) params.set('q', filters.q);
  return params.toString().replace(/%2C/g, ',');
}

export function isDefaultFilters(
  filters: ListingFilters,
  defaults: FilterDefaults
): boolean {
  return serializeFilters(filters, defaults) === '';
}

export interface ListingResult {
  brewery: ListingBrewery;
  open: boolean;
  /** Miles from the origin, when there is one and the brewery has coordinates */
  distance: number | null;
  /** Position in the server's order (rating or best-of score) */
  rank: number;
}

const fold = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

function matchesQuery(b: ListingBrewery, q: string): boolean {
  const haystack = fold([b.name, b.city, b.county, b.street].join(' '));
  return fold(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

const byName = (a: ListingResult, b: ListingResult) =>
  a.brewery.name.localeCompare(b.brewery.name);

/**
 * Filter and sort. `breweries` arrive in the page's default order (by rating, or by best-of
 * score), which the 'rank' sort keeps and the other sorts use to break ties.
 */
export function applyFilters(
  breweries: ListingBrewery[],
  filters: ListingFilters,
  {
    now = new Date(),
    origin = null,
    storedDistances = false,
  }: {
    now?: Date;
    origin?: LatLng | null;
    /** Use each brewery's own `distance` (from the page origin) when it has one */
    storedDistances?: boolean;
  } = {}
): ListingResult[] {
  const amenityDefs = filters.amenities
    .map((slug) => getAmenity(slug))
    .filter((a): a is NonNullable<typeof a> => !!a);
  const results: ListingResult[] = [];
  breweries.forEach((brewery, rank) => {
    if (
      amenityDefs.length > 0 &&
      !amenityDefs.every((def) => hasAmenity(brewery, def))
    )
      return;
    if (filters.type && !brewery.types.some((t) => slugify(t) === filters.type))
      return;
    if (filters.q && !matchesQuery(brewery, filters.q)) return;
    const open = isOpenAt(brewery.hours, now).open;
    if (filters.open && !open) return;
    const distance =
      storedDistances && brewery.distance !== undefined
        ? brewery.distance
        : origin && brewery.latitude !== null && brewery.longitude !== null
        ? distanceMiles(origin, {
            latitude: brewery.latitude,
            longitude: brewery.longitude,
          })
        : null;
    results.push({ brewery, open, distance, rank });
  });
  return sortResults(results, filters.sort);
}

export function sortResults(
  results: ListingResult[],
  sort: SortKey
): ListingResult[] {
  const byRank = (a: ListingResult, b: ListingResult) => a.rank - b.rank;
  const sorted = [...results];
  switch (sort) {
    case 'open':
      return sorted.sort(
        (a, b) => Number(b.open) - Number(a.open) || byRank(a, b)
      );
    case 'distance':
      // Without an origin or coordinates, fall back to the default order at the end
      return sorted.sort(
        (a, b) =>
          (a.distance ?? Infinity) - (b.distance ?? Infinity) || byRank(a, b)
      );
    case 'name':
      return sorted.sort((a, b) => byName(a, b) || byRank(a, b));
    case 'rank':
      return sorted.sort(byRank);
  }
}

/** Amenities present in a list, with counts, in the canonical AMENITIES order. */
export function amenityOptions(
  breweries: ListingBrewery[]
): { slug: string; label: string; count: number }[] {
  return AMENITIES.map((a) => ({
    slug: a.slug,
    label: a.label,
    count: breweries.filter((b) => hasAmenity(b, a)).length,
  })).filter((a) => a.count > 0);
}

/** Types present in a list, by count. */
export function typeOptions(
  breweries: ListingBrewery[]
): { slug: string; label: string; count: number }[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const b of breweries) {
    for (const t of b.types) {
      const slug = slugify(t);
      const entry = counts.get(slug) ?? { label: t, count: 0 };
      entry.count++;
      counts.set(slug, entry);
    }
  }
  return [...counts.entries()]
    .map(([slug, v]) => ({ slug, ...v }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** "0.4 mi", "12 mi" */
export function formatMiles(miles: number): string {
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}
