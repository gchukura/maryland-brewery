'use client';

/**
 * The interactive part of every listing page: filters (kept in the URL), the list and the map.
 * Pages are statically generated with the full list; filtering happens here on that list.
 *
 * useSearchParams() makes a static page render this part in the browser only, showing the Suspense
 * fallback in the HTML. The fallback is this same view with default filters, so crawlers and
 * no-JS visitors still get the whole list.
 */
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LocateFixed, Search } from 'lucide-react';
import type { LatLng } from '@/lib/geo';
import {
  SORT_LABELS,
  amenityOptions,
  applyFilters,
  formatMiles,
  isDefaultFilters,
  parseFilters,
  serializeFilters,
  typeOptions,
  type FilterDefaults,
  type ListingBrewery,
  type ListingFilters,
  type SortKey,
} from '@/lib/listing';
import { getAmenity } from '@/lib/amenities';
import { isOpenAt, todayHours } from '@/lib/hours';
import { cn } from '@/lib/utils';
import { FilterChip } from '@/components/ui/Chip';
import { Button } from '@/components/ui/button';
import BreweryListRow from '@/components/ui/BreweryListRow';
import BreweryMapLazy, { type MapLandmark } from '@/components/maps/BreweryMapLazy';

const PAGE_SIZE = 12;

export interface BreweryListMapProps {
  breweries: ListingBrewery[];
  defaults: FilterDefaults;
  /** Sorts offered in the menu, in order. 'distance' is added when there's an origin. */
  sorts: SortKey[];
  /** Filters fixed by the page itself (the amenity of an amenity page, ...), hidden from the bar */
  locked?: { amenity?: string; type?: string };
  /** Page origin for distances (neighborhood pages) */
  origin?: LatLng | null;
  /** When the server rendered the page; the first client render uses it so the HTML matches */
  renderedAt: number;
  /** Show each brewery's hours for today (attraction pages) */
  showTodayHours?: boolean;
  /** A pin for the place the page is about (attraction pages) */
  landmark?: MapLandmark | null;
}

export default function BreweryListMap(props: BreweryListMapProps) {
  return (
    <Suspense fallback={<ListingView {...props} params={null} />}>
      <WithSearchParams {...props} />
    </Suspense>
  );
}

function WithSearchParams(props: BreweryListMapProps) {
  const params = useSearchParams();
  return <ListingView {...props} params={params} />;
}

type GeoState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'denied'; message: string }
  | { status: 'ok'; origin: LatLng };

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return desktop;
}

function describe(
  count: number,
  filters: ListingFilters,
  typeLabel: string | undefined
): string {
  const parts: string[] = [];
  if (filters.open) parts.push('open');
  for (const slug of filters.amenities)
    parts.push((getAmenity(slug)?.label ?? slug).toLowerCase());
  const noun = typeLabel
    ? typeLabel.toLowerCase()
    : count === 1
      ? 'brewery'
      : 'breweries';
  const plural =
    typeLabel && count !== 1 && !/s$/.test(noun) ? `${noun}s` : noun;
  const what = [parts.join(', '), plural].filter(Boolean).join(' ');
  const matching = filters.q ? ` matching “${filters.q}”` : '';
  return `Showing ${count} ${what}${matching}, ${SORT_LABELS[filters.sort].toLowerCase()}`;
}

function ListingView({
  breweries,
  defaults,
  sorts,
  locked,
  origin: pageOrigin = null,
  renderedAt,
  showTodayHours = false,
  landmark = null,
  params,
}: BreweryListMapProps & { params: URLSearchParams | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const filters = useMemo(
    () => parseFilters(params, defaults),
    [params, defaults]
  );

  // Open/closed is computed for "now"; start from the server's moment so hydration matches
  const [now, setNow] = useState(() => new Date(renderedAt));
  const [ready, setReady] = useState(false); // data-ready: hydrated (tests wait for it)
  useEffect(() => {
    setReady(true);
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });
  const origin = geo.status === 'ok' ? geo.origin : pageOrigin;

  const update = useCallback(
    (
      next: Partial<ListingFilters>,
      { replace = false }: { replace?: boolean } = {}
    ) => {
      const qs = serializeFilters({ ...filters, ...next }, defaults);
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [filters, defaults, pathname, router]
  );

  const locateMe = () => {
    if (!('geolocation' in navigator)) {
      setGeo({
        status: 'denied',
        message: "Your browser can't share your location.",
      });
      return;
    }
    setGeo({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          status: 'ok',
          origin: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          },
        });
        update({ sort: 'distance' });
      },
      (err) =>
        setGeo({
          status: 'denied',
          message:
            err.code === err.PERMISSION_DENIED
              ? 'Location is blocked for this site, so we can’t sort by distance.'
              : 'We couldn’t get your location; try again.',
        }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }
    );
  };

  // ?near=1 (the homepage's Near me chip) asks for the location once on arrival; the param is
  // dropped from the URL when the distance sort is written
  const askedNear = useRef(false);
  useEffect(() => {
    if (askedNear.current || params?.get('near') !== '1') return;
    askedNear.current = true;
    locateMe();
  });

  const sortOptions =
    origin && !sorts.includes('distance')
      ? [...sorts, 'distance' as const]
      : sorts;
  // Distance sort needs an origin; without one, fall back to the page default
  const effective: ListingFilters = useMemo(
    () => ({
      ...filters,
      sort:
        filters.sort === 'distance' && !origin ? defaults.sort : filters.sort,
    }),
    [filters, origin, defaults.sort]
  );
  const results = useMemo(
    () =>
      applyFilters(breweries, effective, {
        now,
        origin,
        // The page's own distances, until the visitor sorts by their location
        storedDistances: geo.status !== 'ok',
      }),
    [breweries, effective, now, origin, geo.status]
  );

  const amenities = useMemo(
    () => amenityOptions(breweries).filter((a) => a.slug !== locked?.amenity),
    [breweries, locked?.amenity]
  );
  const types = useMemo(() => typeOptions(breweries), [breweries]);
  const typeLabel = filters.type
    ? types.find((t) => t.slug === filters.type)?.label
    : undefined;

  // "Show N more" resets whenever the filters change
  const filterKey = serializeFilters(effective, defaults);
  const [visible, setVisible] = useState(PAGE_SIZE);
  useEffect(() => setVisible(PAGE_SIZE), [filterKey]);

  // The text box writes to the URL after typing pauses, without a history entry per keystroke
  const [query, setQuery] = useState(filters.q);
  useEffect(() => setQuery(filters.q), [filters.q]);
  const typing = useRef<number | undefined>(undefined);
  const onQuery = (value: string) => {
    setQuery(value);
    window.clearTimeout(typing.current);
    typing.current = window.setTimeout(
      () => update({ q: value.trim() }, { replace: true }),
      300
    );
  };

  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const desktop = useIsDesktop();
  const showMap = desktop || view === 'map';
  // Every brewery stays on the map component; filters change which ones are visible
  const points = useMemo(
    () =>
      breweries.map((b) => ({ brewery: b, open: isOpenAt(b.hours, now).open })),
    [breweries, now]
  );
  const visibleSlugs = useMemo(
    () => results.map((r) => r.brewery.slug),
    [results]
  );

  const preferAmenities = useMemo(
    () => effective.amenities.map((slug) => getAmenity(slug)?.label ?? slug),
    [effective.amenities]
  );

  const toggleAmenity = (slug: string) =>
    update({
      amenities: filters.amenities.includes(slug)
        ? filters.amenities.filter((a) => a !== slug)
        : [...filters.amenities, slug],
    });

  return (
    <div
      className="flex flex-col gap-5"
      data-listing=""
      data-ready={ready ? '' : undefined}
    >
      {/* Filter bar */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-[1_1_260px]">
            <span className="sr-only">Search these breweries</span>
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Name, city or street"
              className="h-11 w-full rounded-control border-[1.5px] border-line-strong bg-white pl-10 pr-3 text-[15px] text-ink placeholder:text-muted focus:border-ink focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            Sort
            <select
              value={effective.sort}
              onChange={(e) => update({ sort: e.target.value as SortKey })}
              className="h-11 rounded-control border-[1.5px] border-line-strong bg-white px-3 text-sm font-medium text-ink"
            >
              {sortOptions.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            size="md"
            onClick={locateMe}
            disabled={geo.status === 'locating'}
            aria-pressed={geo.status === 'ok'}
          >
            <LocateFixed className="h-4 w-4" aria-hidden="true" />
            {geo.status === 'locating' ? 'Locating…' : 'Near me'}
          </Button>
        </div>
        {/* One sideways-scrolling row on phones (Mobile.html), wrapping from sm up */}
        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:shrink-0"
          role="group"
          aria-label="Filters"
        >
          {!defaults.open && (
            <FilterChip
              pressed={filters.open}
              highlight="gold"
              onClick={() => update({ open: !filters.open })}
            >
              Open now
            </FilterChip>
          )}
          {amenities.map((a) => (
            <FilterChip
              key={a.slug}
              pressed={filters.amenities.includes(a.slug)}
              onClick={() => toggleAmenity(a.slug)}
            >
              {a.label}
            </FilterChip>
          ))}
          {!locked?.type && types.length > 1 && (
            <select
              aria-label="Brewery type"
              value={filters.type ?? ''}
              onChange={(e) => update({ type: e.target.value || null })}
              className={cn(
                'h-[38px] rounded-chip border-[1.5px] px-3 text-[13px] font-semibold',
                filters.type
                  ? 'border-ink bg-ink text-paper'
                  : 'border-line-strong bg-white text-ink'
              )}
            >
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.label} ({t.count})
                </option>
              ))}
            </select>
          )}
          {!isDefaultFilters(effective, defaults) && (
            <button
              type="button"
              onClick={() => router.push(pathname, { scroll: false })}
              className="tap px-2 text-[13px] font-semibold text-brand-red hover:text-brand-red-dark"
            >
              Clear all
            </button>
          )}
        </div>
        {geo.status === 'denied' && (
          <p className="m-0 text-[13px] text-muted">{geo.message}</p>
        )}
      </div>

      {/* Phone: List | Map */}
      <div
        className="grid grid-cols-2 rounded-control border-[1.5px] border-ink p-0.5 lg:hidden"
        role="group"
        aria-label="View"
      >
        {(
          [
            ['list', 'List'],
            ['map', 'Map'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn(
              'h-10 rounded-[8px] text-sm font-semibold',
              view === v ? 'bg-ink text-paper' : 'text-ink'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div
          className={cn(
            'min-w-0 flex-[999_1_560px] flex-col gap-3.5',
            view === 'map' ? 'hidden lg:flex' : 'flex'
          )}
        >
          <div aria-live="polite" className="text-[13px] text-muted">
            {describe(results.length, effective, typeLabel)}
          </div>
          {results.slice(0, visible).map((r, i) => (
            <BreweryListRow
              key={r.brewery.slug}
              brewery={r.brewery}
              distance={
                r.distance !== null ? formatMiles(r.distance) : undefined
              }
              priority={i < 2}
              active={highlighted === r.brewery.slug}
              onHighlight={setHighlighted}
              preferAmenities={preferAmenities}
              today={showTodayHours ? todayHours(r.brewery.hours, now) : undefined}
            />
          ))}
          {results.length === 0 && (
            <div className="rounded-panel border border-line bg-white p-6 text-center">
              <p className="m-0 mb-3 text-ink">
                No breweries match these filters.
              </p>
              <Button
                variant="secondary"
                onClick={() => router.push(pathname, { scroll: false })}
              >
                Clear filters
              </Button>
            </div>
          )}
          {results.length > visible && (
            <Button
              variant="secondary"
              className="self-center"
              onClick={() => setVisible((n) => n + PAGE_SIZE)}
            >
              Show {Math.min(PAGE_SIZE, results.length - visible)} more
            </Button>
          )}
        </div>
        <div
          data-listing-map=""
          className={cn(
            'min-w-0 flex-[1_1_420px] overflow-hidden rounded-panel border border-line',
            'h-[70vh] lg:sticky lg:top-6 lg:h-[calc(100vh-48px)] lg:max-h-[720px]',
            view === 'list' && 'hidden lg:block'
          )}
        >
          {showMap && (
            <BreweryMapLazy
              points={points}
              visible={visibleSlugs}
              highlighted={highlighted}
              onHighlight={setHighlighted}
              landmark={landmark}
            />
          )}
        </div>
      </div>
    </div>
  );
}
